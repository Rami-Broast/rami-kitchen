/**
 * Which build of this app is running.
 *
 * ## Why this exists
 *
 * The same reason it exists in `admin-app`, met a second time: a change was
 * merged, its CI went green, the backend deployed — and nobody at the counter
 * could tell whether the terminal in front of them contained it. "Is this the
 * new build?" was an unanswerable question, so a bug report and a stale bundle
 * looked identical, and every round of diagnosis started by re-proving code
 * that was already correct.
 *
 * The Branch POS needs this more than the admin panel does, not less. It runs
 * on a machine at a counter that nobody reloads, in a browser nobody watches,
 * often on a shop network — and a Vite SPA served from a CDN will happily hand
 * back a cached `index.html` pointing at the previous bundle long after the
 * deploy went green.
 *
 * The values come from `vite.config.ts` at build time. Vercel exposes the
 * commit as `VERCEL_GIT_COMMIT_SHA`, GitHub Actions as `GITHUB_SHA`; a local
 * build has neither and honestly says "local". Nothing here is a secret: the
 * commit is public in the repository, and the build time is the fact the reader
 * actually wants.
 */

declare const __BUILD_SHA__: string;
declare const __BUILT_AT__: string;

/** Short commit SHA, or 'local' for a build made outside CI. */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'local';

/** ISO timestamp of the build. */
export const BUILT_AT: string = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';

/**
 * "a3f9c21 · today 14:23" — enough to compare against a merge without asking
 * anyone at a counter to read an ISO string.
 *
 * Pure, and takes `now`, so the relative part is testable. A build older than
 * today drops the "today" shorthand and shows the date, because that is where
 * the question changes from "did my change land" to "how stale is this".
 */
export function buildLabel(
  sha: string = BUILD_SHA,
  builtAt: string = BUILT_AT,
  now: Date = new Date(),
): string {
  const when = builtAt ? new Date(builtAt) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return sha;
  }

  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay = when.toDateString() === now.toDateString();
  if (sameDay) {
    return `${sha} · today ${time}`;
  }

  const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${sha} · ${date} ${time}`;
}
