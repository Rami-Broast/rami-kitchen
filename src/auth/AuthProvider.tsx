import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '../api/config';
import { Api } from '../api/endpoints';
import { loadDocketTemplate } from '../print/template';
import { configureQzSigning } from '../print/qz-signing';
import { setQzPrepare } from '../print/printer';
import { ApiClient } from '../api/http';
import { Branch, CurrentActor } from '../api/types';

const TOKEN_KEY = 'rami.pos.tokens';

interface Stored {
  accessToken: string;
  refreshToken: string;
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

interface AuthContextValue {
  api: Api;
  isAuthenticated: boolean;
  actor: CurrentActor | null;
  /** The branch this POS operates, resolved from the signed-in staff member. */
  branchId: string | null;
  /** The resolved branch (name + operating settings), for the banner and order entry. */
  branch: Branch | null;
  /** True when the signed-in staff member reaches every branch (owner) — the POS is single-branch, so this is surfaced as a warning. */
  isMultiBranch: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Owns the branch-staff session, the single Api instance, and the resolved actor. */
export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [tokens, setTokens] = useState<Stored | null>(() => load());
  const [actor, setActor] = useState<CurrentActor | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);

  const persist = useCallback((next: Stored | null): void => {
    setTokens(next);
    try {
      if (next) {
        localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // ignore storage errors
    }
    if (!next) {
      setActor(null);
      setBranch(null);
    }
  }, []);

  const api = useMemo(
    () => new Api(new ApiClient(API_BASE_URL, () => load()?.accessToken ?? null, () => persist(null))),
    [persist],
  );

  useEffect(() => {
    if (!tokens) {
      setActor(null);
      return;
    }
    let cancelled = false;
    api
      .me()
      .then((a) => {
        if (!cancelled) setActor(a);
      })
      .catch(() => {
        // 401 clears the token via ApiClient.onUnauthorized.
      });
    return () => {
      cancelled = true;
    };
  }, [api, tokens]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const t = await api.login(email, password);
      persist({ accessToken: t.accessToken, refreshToken: t.refreshToken });
    },
    [api, persist],
  );

  const branchId = actor?.branchScope.branchIds?.[0] ?? null;

  // Resolve the branch's name + operating settings from the public branch list,
  // once we know which branch the signed-in staff member is bound to. The POS
  // shows this in a persistent banner so staff always see which branch they are
  // working — reinforcing that everything on screen is their own branch only.
  useEffect(() => {
    if (!branchId) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    api
      .branches()
      .then((all) => {
        if (!cancelled) {
          setBranch(all.find((b) => b.id === branchId) ?? null);
        }
      })
      .catch(() => {
        // Non-fatal: the banner degrades to the branch id; queues still work.
      });
    return () => {
      cancelled = true;
    };
  }, [api, branchId]);

  // Request signing, installed as soon as there is a signed-in API client to
  // sign through. It is registered rather than run: QZ reads the certificate
  // when the socket opens, and the socket opens on the first print — so the
  // engine calls this immediately before connecting.
  useEffect(() => {
    if (!tokens) {
      return;
    }
    setQzPrepare(async () => {
      await configureQzSigning(api);
    });
  }, [api, tokens]);

  // The docket template this branch prints, fetched once the branch is known
  // and cached on this machine. Best-effort on purpose: a terminal that cannot
  // reach the API prints the template it already has, and a brand-new terminal
  // prints the built-in one. A print that fails because a layout would not
  // load is a print that did not happen, with the customer at the counter.
  useEffect(() => {
    if (branchId) {
      void loadDocketTemplate(api, branchId);
    }
  }, [api, branchId]);

  const value = useMemo<AuthContextValue>(() => {
    const scope = actor?.branchScope;
    return {
      api,
      isAuthenticated: !!tokens,
      actor,
      branchId,
      branch,
      isMultiBranch: scope?.kind === 'ALL' || (scope?.branchIds?.length ?? 0) > 1,
      signIn,
      /**
       * Ends the session on the server, then locally.
       *
       * Dropping the token locally is not signing out: the refresh token stays
       * valid for its full lifetime, so the next person at this machine could
       * resume the session. The local clear happens regardless of the result —
       * signing out must never fail because the network did.
       */
      signOut: async () => {
        const refreshToken = tokens?.refreshToken;
        if (refreshToken) {
          try {
            await api.logout(refreshToken);
          } catch {
            // Already expired, revoked, or offline. Nothing more to do here.
          }
        }
        persist(null);
      },
    };
  }, [api, tokens, actor, branch, branchId, signIn, persist]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
