import { describe, expect, it, vi } from 'vitest';
import {
  calculateAttendancePercentage,
  formatDisplayDate,
  generateToken,
  getDateStringInTimeZone,
  getMonthKeyInTimeZone,
  getNextMonthKey,
  isTokenExpired,
  rateLimit,
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

  it('formats display date as dd-mm-yy', () => {
    expect(formatDisplayDate('2026-04-04')).toBe('04-04-26');
  });

  it('returns original value when date format is invalid', () => {
    expect(formatDisplayDate('04/04/2026')).toBe('04/04/2026');
  });

  it('calculates attendance percentage with rounding', () => {
    expect(calculateAttendancePercentage(12, 43)).toBe(28);
    expect(calculateAttendancePercentage(13, 44)).toBe(30);
  });

  it('returns 0 attendance percentage when total is 0', () => {
    expect(calculateAttendancePercentage(0, 0)).toBe(0);
    expect(calculateAttendancePercentage(10, 0)).toBe(0);
  });

  it('gets month key in time zone', () => {
    const date = new Date('2026-03-31T20:30:00Z');
    expect(getMonthKeyInTimeZone(date, 'Asia/Kolkata')).toBe('2026-04');
  });

  it('gets next month key correctly', () => {
    expect(getNextMonthKey('2026-04')).toBe('2026-05');
    expect(getNextMonthKey('2026-12')).toBe('2027-01');
  });

  it('allows exactly 100 requests per minute per key', () => {
    const key = `rate-limit-100-${Date.now()}`;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const result = rateLimit(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100 - attempt);
    }

    const blocked = rateLimit(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets allowance after the 60-second window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'));

    const key = 'rate-limit-window-reset';
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      rateLimit(key);
    }

    expect(rateLimit(key).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    const resetAttempt = rateLimit(key);
    expect(resetAttempt.allowed).toBe(true);
    expect(resetAttempt.remaining).toBe(99);

    vi.useRealTimers();
  });
});
