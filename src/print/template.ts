/**
 * The docket template this branch prints, cached on the machine.
 *
 * The layout is the owner's, edited in the admin panel and resolved per branch
 * by the backend. This terminal fetches it and holds it, for the same reason
 * the printer configuration lives here: **printing must not depend on the
 * network being up at the moment somebody presses print.**
 *
 * Three rules follow from that, and each is a way a counter loses a receipt:
 *
 *  - **A failed fetch keeps whatever is cached**, and prints the built-in
 *    template if there is nothing cached. A print that fails because the
 *    template could not be loaded is a print that did not happen, and the
 *    customer is standing at the counter.
 *  - **The cache is written to `localStorage`**, so a terminal that starts up
 *    with the shop's connection down still prints the branch's own template
 *    rather than reverting to the default.
 *  - **An unreadable cache is not an error.** It falls through to the default,
 *    which is a working receipt.
 */
import { Api } from '../api/endpoints';
import { DEFAULT_DOCKET_TEMPLATE, DocketTemplate } from './docket';
import { logoSource, prepareLogo } from './logo';

const STORAGE_KEY = 'bah.pos.docketTemplate';

/** Fills in any key a template saved by an older editor does not carry. */
export function withDefaults(stored: unknown): DocketTemplate {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return DEFAULT_DOCKET_TEMPLATE;
  }
  const source = stored as Partial<DocketTemplate>;
  return {
    ...DEFAULT_DOCKET_TEMPLATE,
    ...source,
    readyTimeRules: {
      ...DEFAULT_DOCKET_TEMPLATE.readyTimeRules,
      ...(source.readyTimeRules ?? {}),
    },
  };
}

let cached: DocketTemplate | null = null;

/** The template to print with, right now. Never throws, never null. */
export function docketTemplate(): DocketTemplate {
  if (cached) {
    return cached;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw ? withDefaults(JSON.parse(raw)) : DEFAULT_DOCKET_TEMPLATE;
  } catch {
    cached = DEFAULT_DOCKET_TEMPLATE;
  }
  return cached;
}

/**
 * Fetches this branch's template and caches it.
 *
 * Best-effort by design: a rejection leaves the cached template in place and
 * says so in the return value, for a caller that wants to show it. Nothing
 * about it blocks a print.
 */
export async function loadDocketTemplate(api: Api, branchId: string): Promise<boolean> {
  try {
    const { resolved } = await api.receiptTemplate(branchId);
    cacheDocketTemplate(resolved);
    return true;
  } catch {
    return false;
  }
}

/**
 * Puts a template the caller already fetched into the printing cache.
 *
 * The Receipt screen needs the whole response — the owner's default and this
 * branch's override, not only the resolved result — so it makes the request
 * itself. This is how what it fetched becomes what the next print uses: without
 * it a branch could save a change, watch the preview update, and have the
 * printer keep producing the previous receipt until the next sign-in.
 */
export function cacheDocketTemplate(resolved: unknown): DocketTemplate {
  cached = withDefaults(resolved);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // A full or blocked storage costs the offline copy and nothing else.
  }
  return cached;
}

/**
 * The logo for a docket, prepared for this roll — or null.
 *
 * Cached per (source, width) because a busy counter prints a docket a minute
 * and rasterising the same wordmark each time is work nobody asked for. The
 * cache is in memory only: a template change reloads the page's cache with it.
 */
const logoCache = new Map<string, string | null>();

export async function docketLogo(paperWidth: number): Promise<string | null> {
  const template = docketTemplate();
  // Two ways to print no logo: the owner switched it off, or the section is
  // not in the layout at all.
  if (!template.printLogoImage || !template.sections.includes('logo')) {
    return null;
  }

  const src = logoSource(template.logoImageUrl);
  // The size is part of the key: an owner who shrinks the logo and reprints
  // must not get the cached full-width one back.
  const percent = template.logoWidthPercent ?? 100;
  const key = `${src}@${paperWidth}@${percent}`;
  const cached = logoCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const prepared = await prepareLogo(src, paperWidth, percent);
  logoCache.set(key, prepared);
  return prepared;
}

/** Test seam. */
export function resetDocketTemplateCache(): void {
  cached = null;
  logoCache.clear();
}
