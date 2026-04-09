// Simple in-memory sliding window rate limiter
const store = new Map<string, number[]>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100;

export function rateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = store.get(key) ?? [];
  
  // Remove expired timestamps
  const valid = timestamps.filter((t) => now - t < WINDOW_MS);
  
  if (valid.length >= MAX_REQUESTS) {
    store.set(key, valid);
    return { allowed: false, remaining: 0 };
  }
  
  valid.push(now);
  store.set(key, valid);
  return { allowed: true, remaining: MAX_REQUESTS - valid.length };
}

export function generateToken(): string {
  const chars = 'ABCDEF0123456789';
  let token = '';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 4; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

export function isTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function getDateStringInTimeZone(
  date: Date = new Date(),
  timeZone: string = 'Asia/Kolkata'
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to format date in time zone');
  }

  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(dateValue: string): string {
  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateValue;
  }

  const [, year, month, day] = match;
  return `${day}-${month}-${year.slice(-2)}`;
}

export function calculateAttendancePercentage(present: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((present / total) * 100);
}

export function getMonthKeyInTimeZone(
  date: Date = new Date(),
  timeZone: string = 'Asia/Kolkata'
): string {
  return getDateStringInTimeZone(date, timeZone).slice(0, 7);
}

export function getNextMonthKey(monthKey: string): string {
  const [yearPart, monthPart] = monthKey.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Invalid month key format. Expected YYYY-MM');
  }

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export const TOKEN_VALIDITY_SECONDS = 30;
