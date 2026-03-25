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
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

export function isTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export const TOKEN_VALIDITY_SECONDS = 15;
