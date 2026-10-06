import { describe, expect, it } from 'vitest';

import { buildLabel } from './buildInfo';

/**
 * The label is unit-tested for the same reason the print builders are: it is
 * read off a screen by someone deciding whether a bug is real or whether the
 * terminal is simply running last week's bundle. A marker that renders
 * "Invalid Date" answers neither question and quietly destroys trust in the one
 * signal that was supposed to settle it.
 */
describe('buildLabel', () => {
  const NOW = new Date('2026-09-06T15:00:00Z');

  it('shows the commit and a same-day time as "today"', () => {
    const label = buildLabel('a3f9c21', '2026-09-06T12:16:00Z', NOW);

    expect(label).toContain('a3f9c21');
    expect(label).toContain('today');
  });

  it('shows a date instead once the build is not from today', () => {
    // Past today the question stops being "did my change land" and becomes
    // "how stale is this", which a bare time cannot answer.
    const label = buildLabel('a3f9c21', '2026-09-01T12:16:00Z', NOW);

    expect(label).toContain('a3f9c21');
    expect(label).not.toContain('today');
  });

  it('falls back to the commit alone rather than printing an invalid date', () => {
    expect(buildLabel('a3f9c21', '', NOW)).toBe('a3f9c21');
    expect(buildLabel('a3f9c21', 'not-a-date', NOW)).toBe('a3f9c21');
  });

  it('says "local" honestly for a build made outside CI', () => {
    // A local build claiming a commit would be the one lie this marker cannot
    // afford: its entire job is telling you what is actually running.
    expect(buildLabel('local', '', NOW)).toBe('local');
  });
});
