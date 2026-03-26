import { describe, expect, it } from 'vitest';
import {
  generateToken,
  getDateStringInTimeZone,
  isTokenExpired,
  TOKEN_VALIDITY_SECONDS,
} from './utils';

describe('utils', () => {
  it('generates a 4-char uppercase hex token', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-F0-9]{4}$/);
  });

  it('marks past date as expired', () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    expect(isTokenExpired(past)).toBe(true);
  });

  it('does not mark future date as expired', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isTokenExpired(future)).toBe(false);
  });

  it('uses a 25-second token validity window', () => {
    expect(TOKEN_VALIDITY_SECONDS).toBe(25);
  });

  it('formats dates in the configured time zone', () => {
    const date = new Date('2026-03-27T20:30:00Z');
    expect(getDateStringInTimeZone(date, 'Asia/Kolkata')).toBe('2026-03-28');
  });
});
