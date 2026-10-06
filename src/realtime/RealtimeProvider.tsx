import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

import { API_BASE_URL } from '../api/config';
import { useAuth } from '../auth/AuthProvider';

/** The four server-pushed events (see the backend's `realtime/README.md`). */
export type RealtimeEvent =
  | 'order.awaiting'
  | 'order.transitioned'
  | 'delivery.assigned'
  | 'delivery.unassigned'
  | 'driver.location'
  /**
   * A driver went on or off shift, stepped away, took a job or finished one.
   *
   * It is what turns the assign dialog from a snapshot into a live list. A
   * counter reading "no drivers on shift" used to have no way of learning that
   * somebody had started theirs short of closing and reopening the dialog —
   * during service, with the food on the pass.
   */
  | 'driver.status';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type Handler = (payload: unknown) => void;

interface RealtimeContextValue {
  status: ConnectionStatus;
  /** Subscribe to one server event. Returns an unsubscribe function. */
  subscribe: (event: RealtimeEvent, handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/** Where the token is kept. Must match `auth/AuthProvider.tsx`. */
const TOKEN_KEY = 'rami.pos.tokens';

/** The API base is `<origin>/api/v1`; the socket lives at `<origin>` path `/realtime`. */
function socketOrigin(): string {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return window.location.origin;
  }
}

/**
 * One authenticated socket for the signed-in branch, fanned out to any screen
 * that subscribes.
 *
 * **The board is why this exists.** During service the counter is watching the
 * New Orders column, and an eight-second poll means a customer's order can sit
 * unseen for eight seconds after the backend already has it. That is the one
 * screen in this app where latency is actually felt, and the server side was
 * already built and paid for: the gateway authenticates the handshake with the
 * same token service the HTTP guards use, resolves the actor from the database,
 * and joins the socket to exactly the rooms its `BranchScope` allows. Until
 * now the admin panel was the only client connecting to it.
 *
 * **Polling stays.** This layer is an accelerator, not a replacement: it makes
 * the common case instant and the screens keep their interval as the floor.
 * A counter terminal on a flaky shop network must not depend on a socket
 * staying up to show the orders it has to cook, and `useRealtimeReload` also
 * fires once on every (re)connect to catch up on anything missed while down.
 *
 * Emission is one-directional — the client only listens. Every state change
 * still goes through the REST choke points; realtime never becomes a write
 * path.
 *
 * Ported from `admin-app/src/realtime/RealtimeProvider.tsx`, deliberately kept
 * close to it so the two behave the same. The one difference is the token key,
 * which is per app.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    const socket = io(socketOrigin(), {
      path: '/realtime',
      transports: ['websocket', 'polling'],
      // Re-read the token on every (re)connect so a refreshed one is used, and
      // a revoked one is refused rather than replayed.
      auth: (cb) => {
        let token: string | undefined;
        try {
          const raw = localStorage.getItem(TOKEN_KEY);
          token = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
        } catch {
          // A corrupt or unreadable store is not worth taking the board down
          // for — the socket is refused and polling carries the screen.
          token = undefined;
        }
        cb({ token: token ?? '' });
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('disconnected'));
    // The server disconnects an unauthorised socket after emitting this.
    socket.on('unauthorized', () => setStatus('disconnected'));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      subscribe: (event, handler) => {
        const socket = socketRef.current;
        if (!socket) return () => undefined;
        socket.on(event, handler);
        return () => {
          socket.off(event, handler);
        };
      },
    }),
    // `status` is in the deps so a subscribe made before connect re-binds once
    // the socket exists.
    [status],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return ctx;
}

/**
 * Runs `onEvent` when any of `events` fires, and once on every (re)connect.
 *
 * The reconnect call is the important half: a socket that dropped for thirty
 * seconds missed whatever happened in them, and a board that only reacts to
 * live events would stay wrong until the next poll. Intended to drive a
 * screen's existing `refresh()`.
 */
export function useRealtimeReload(events: RealtimeEvent[], onEvent: () => void): ConnectionStatus {
  const { status, subscribe } = useRealtime();
  const cb = useRef(onEvent);
  cb.current = onEvent;

  const key = events.join(',');
  useEffect(() => {
    const unsubs = events.map((e) => subscribe(e, () => cb.current()));
    return () => unsubs.forEach((u) => u());
    // `events` is an array literal at every call site, so its identity changes
    // each render; `key` is the stable stand-in. `status` re-binds the
    // listeners onto a socket that has just been recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, status, key]);

  const wasConnected = useRef(false);
  useEffect(() => {
    if (status === 'connected' && !wasConnected.current) {
      wasConnected.current = true;
      cb.current();
    } else if (status !== 'connected') {
      wasConnected.current = false;
    }
  }, [status]);

  return status;
}
