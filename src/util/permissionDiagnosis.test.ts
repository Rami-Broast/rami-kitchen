import { describe, expect, it } from 'vitest';

import { SCREEN_PERMISSIONS, diagnoseForbidden } from './permissionDiagnosis';

describe('diagnoseForbidden', () => {
  it('names the permission the account is missing', () => {
    const result = diagnoseForbidden('board', ['orders:read', 'menu:read']);

    expect(result.missing).toEqual(['orders:kitchen']);
    expect(result.unexplained).toBe(false);
  });

  it('reports a 403 the account should not have got as unexplained', () => {
    // Re-assigning a role will not fix this one, and saying "missing:" here
    // would send an owner to change something that was never wrong.
    const result = diagnoseForbidden('board', ['orders:kitchen', 'orders:read']);

    expect(result.missing).toEqual([]);
    expect(result.unexplained).toBe(true);
  });

  it('treats a permission list we have not read yet as unexplained, not as missing everything', () => {
    expect(diagnoseForbidden('board', null)).toEqual({ missing: [], unexplained: true });
    expect(diagnoseForbidden('board', undefined)).toEqual({ missing: [], unexplained: true });
  });

  it('lists every permission a screen needs, not just the first', () => {
    const result = diagnoseForbidden('deliveries', ['deliveries:read']);

    expect(result.missing).toEqual(['deliveries:assign', 'drivers:read']);
  });

  it('asks for nothing the KITCHEN role does not hold', () => {
    // Mirrors prisma/seed/permissions.ts. The POS is signed into with whichever
    // credentials the owner gave the branch, and that is as often a KITCHEN user
    // as a BRANCH_ADMIN — a screen requiring something KITCHEN never holds is a
    // 403 by design rather than by misconfiguration.
    const kitchenRole = [
      'orders:read',
      'orders:kitchen',
      'orders:write',
      'menu:read',
      'menu:availability',
      'branches:read',
      'deliveries:read',
      'deliveries:assign',
      'drivers:read',
      // The POS prints the docket, so it reads the template it prints.
      // Editing it needs `receipt-template:branch`, which KITCHEN does not
      // hold — and the Receipt screen gates the editor on that permission
      // rather than listing it here, so a counter account sees the preview
      // and no Save button.
      'receipt-template:read',
      'printing:sign',
      // The one financial permission this role holds, granted on the owner's
      // instruction so a branch can read its own day's takings without ringing
      // the owner. Branch-isolated server-side like every other read here.
      'reports:read',
    ];

    for (const codes of Object.values(SCREEN_PERMISSIONS)) {
      expect(codes.filter((code) => !kitchenRole.includes(code))).toEqual([]);
    }
  });
});
