import { describe, expect, it } from 'vitest';
import {
  calculateAttendancePercentage,
  formatDisplayDate,
  generateToken,
  getDateStringInTimeZone,
  getMonthKeyInTimeZone,
  getNextMonthKey,
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

  it('uses a 30-second token validity window', () => {
    expect(TOKEN_VALIDITY_SECONDS).toBe(30);
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
});
