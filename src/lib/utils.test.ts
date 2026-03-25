import { describe, expect, it } from 'vitest';
import { generateToken, isTokenExpired, TOKEN_VALIDITY_SECONDS } from './utils';

describe('utils', () => {
  it('generates a 6-char uppercase hex token', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-F0-9]{6}$/);
  });

  it('marks past date as expired', () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    expect(isTokenExpired(past)).toBe(true);
  });

  it('does not mark future date as expired', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isTokenExpired(future)).toBe(false);
  });

  it('uses a 15-second token validity window', () => {
    expect(TOKEN_VALIDITY_SECONDS).toBe(15);
  });
});

