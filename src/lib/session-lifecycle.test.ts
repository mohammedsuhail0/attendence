import { describe, it, expect } from 'vitest';
import { isSessionExpiredByAge, AUTO_CLOSE_SESSION_MAX_AGE_MS } from './session-lifecycle';

describe('session-lifecycle', () => {
  it('identifies 30 minutes as AUTO_CLOSE_SESSION_MAX_AGE_MS', () => {
    expect(AUTO_CLOSE_SESSION_MAX_AGE_MS).toBe(30 * 60 * 1000);
  });

  it('returns false for newly created sessions', () => {
    const justNow = new Date().toISOString();
    expect(isSessionExpiredByAge(justNow)).toBe(false);
  });

  it('returns false for sessions created 10 minutes ago', () => {
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isSessionExpiredByAge(tenMinsAgo)).toBe(false);
  });

  it('returns true for sessions created 30 minutes ago', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isSessionExpiredByAge(thirtyMinsAgo)).toBe(true);
  });

  it('returns true for sessions created 45 minutes ago', () => {
    const fortyFiveMinsAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    expect(isSessionExpiredByAge(fortyFiveMinsAgo)).toBe(true);
  });
});
