import { describe, expect, it } from 'vitest';

import { joinUrl, parseApiError } from './http';

describe('joinUrl', () => {
  it('joins base and path with a single slash', () => {
    expect(joinUrl('https://api.test', 'branches')).toBe('https://api.test/branches');
    expect(joinUrl('https://api.test/', '/branches')).toBe('https://api.test/branches');
    expect(joinUrl('https://api.test///', '///branches')).toBe('https://api.test/branches');
  });

  it('keeps interior slashes untouched', () => {
    expect(joinUrl('https://api.test', 'branches/abc/settings')).toBe('https://api.test/branches/abc/settings');
  });
});

describe('parseApiError', () => {
  it('passes through the backend error envelope', () => {
    const shape = parseApiError(400, { statusCode: 400, code: 'VALIDATION', message: 'Bad input', details: ['x'] });
    expect(shape).toEqual({ statusCode: 400, code: 'VALIDATION', message: 'Bad input', details: ['x'] });
  });

  it('falls back to a generic 5xx code and hides the raw message', () => {
    const shape = parseApiError(500, '<html>crash</html>');
    expect(shape.code).toBe('INTERNAL_ERROR');
    expect(shape.statusCode).toBe(500);
    expect(shape.message).not.toContain('crash');
  });

  it('falls back for a non-envelope 4xx body', () => {
    const shape = parseApiError(404, undefined);
    expect(shape.code).toBe('REQUEST_FAILED');
    expect(shape.statusCode).toBe(404);
  });

  it('uses the outer status when the envelope omits statusCode', () => {
    const shape = parseApiError(403, { code: 'FORBIDDEN', message: 'No' });
    expect(shape.statusCode).toBe(403);
    expect(shape.code).toBe('FORBIDDEN');
  });
});
