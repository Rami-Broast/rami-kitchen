import React from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useLang } from '../i18n/LangProvider';
import { APP_VERSION } from '../version';
import { buildLabel } from '../util/buildInfo';

export type PosView =
  | 'board'
  | 'new'
  | 'lookup'
  | 'menu'
  | 'deliveries'
  | 'reports'
  | 'receipt'
  | 'settings';

const NAV: { view: PosView; key: string }[] = [
  { view: 'board', key: 'navOrders' },
  { view: 'new', key: 'navNewOrder' },
  { view: 'lookup', key: 'navLookup' },
  { view: 'menu', key: 'navMenu' },
  { view: 'deliveries', key: 'navDeliveries' },
  // After the operational tabs and before the settings-ish ones: reports are
  // read at handover and between rushes, not while working the board.
  { view: 'reports', key: 'navReports' },
  // Beside Print settings rather than inside it: what the receipt looks like is
  // a service-time question, and Print settings is the screen a branch is told
  // to leave alone once the printer works.
  { view: 'receipt', key: 'navReceipt' },
  { view: 'settings', key: 'navPrint' },
];

/**
 * The app chrome shared by every screen: brand, the branch banner (so staff
 * always see which branch they are working — and that it is only theirs), the
 * nav tabs, the language toggle and sign-out.
 */
export function Shell({
  view,
  onNavigate,
  children,
}: {
  view: PosView;
  onNavigate: (view: PosView) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { actor, branch, branchId, isMultiBranch, signOut } = useAuth();
  const { t, name, lang, toggle } = useLang();

  const branchLabel = branch ? name(branch) : branchId ? `#${branchId.slice(0, 8)}` : null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        {/* The brand is the logo, not the word. Same asset and the same
            treatment as `admin-app`'s Layout header, so the counter terminal
            and the owner's panel read as one platform rather than two products
            that happen to share a name.

            `alt` still carries the name: it is what a screen reader announces
            and what shows if the file ever fails to load, and a header that
            collapses to nothing is worse than one that says the word. The app
            descriptor stays beside it — three apps share this brand, and which
            one you are signed into is the useful half of this line. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src="/logo.jpeg"
            alt={t('brand')}
            style={{ height: 32, objectFit: 'contain', display: 'block' }}
          />
          <span className="muted">{t('branchPos')}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {actor?.fullName ? <span className="muted">{actor.fullName}</span> : null}
          <button
            className="btn ghost"
            onClick={toggle}
            aria-label="Switch language"
            title="English / العربية"
          >
            {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <button className="btn ghost" onClick={() => void signOut()}>
            {t('signOut')}
          </button>
        </div>
      </header>

      {branchLabel ? (
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            marginBottom: 12,
            // Tonal, not the brand magenta: this banner says which branch you
            // are signed in as, which is orientation rather than an action.
            borderInlineStart: '3px solid var(--accent)',
          }}
        >
          <span aria-hidden>📍</span>
          <strong>{branchLabel}</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            · {t('yourBranchOnly')}
          </span>
        </div>
      ) : null}

      {isMultiBranch ? (
        <div
          className="card"
          role="note"
          style={{ marginBottom: 12, borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          {t('ownerSingleBranch')}
        </div>
      ) : null}

      <nav
        aria-label="Sections"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
      >
        {NAV.map((n) => (
          <button
            key={n.view}
            className={`btn ${view === n.view ? 'brand' : 'secondary'}`}
            aria-current={view === n.view ? 'page' : undefined}
            onClick={() => onNavigate(n.view)}
          >
            {t(n.key)}
          </button>
        ))}
      </nav>

      {children}

      {/* The build marker. It answers "is this terminal running the change we
          shipped?" — a question that is otherwise unanswerable from the counter,
          and one that makes a stale bundle and a real bug look identical. See
          `util/buildInfo.ts`. Worth more than the 11px it occupies. */}
      <footer className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 24, paddingBottom: 8 }}>
        Rami Broast POS · v{APP_VERSION} · <span className="mono">{buildLabel()}</span>
      </footer>
    </div>
  );
}

/**
 * A board section's heading.
 *
 * `count` is separated from the label rather than glued on with a `·`, because
 * "how many are waiting" is the number a counter reads first and it should be
 * findable in the same place every time rather than at the end of a sentence
 * whose length changes with the language.
 *
 * The heading is sticky (see `.column-head`): during service the list under it
 * scrolls, and a cook glancing up needs to know which list they are looking at
 * without scrolling back.
 */
export function SectionTitle({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}): React.JSX.Element {
  return (
    <h2 className="column-head" style={{ fontSize: 15, margin: '0 0 12px' }}>
      <span>{children}</span>
      {typeof count === 'number' && count > 0 ? (
        <span className="column-count">{count}</span>
      ) : null}
    </h2>
  );
}

/**
 * The order board.
 *
 * `minmax(280px, 1fr)` with `auto-fill`: a counter terminal is usually one wide
 * screen, so this wants to make columns rather than one long strip — but the
 * same app runs on a tablet at the pass, where forcing three columns would cut
 * every order in half.
 */
export function Grid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  );
}

/** A dismissable error banner with an optional retry. */
export function ErrorBanner({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="card"
      style={{
        borderColor: 'var(--danger)',
        color: 'var(--danger)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}
    >
      <span>{message}</span>
      {onRetry ? (
        <button className="btn secondary" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </button>
      ) : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 10,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <strong>{title}</strong>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A labelled form field wrapper for accessible inputs. */
export function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
}): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
