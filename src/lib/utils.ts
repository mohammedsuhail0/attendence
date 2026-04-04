// Simple in-memory sliding window rate limiter
const store = new Map<string, number[]>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 5;

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

export const TOKEN_VALIDITY_SECONDS = 25;
