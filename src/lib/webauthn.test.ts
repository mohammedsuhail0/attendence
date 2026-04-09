import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { getWebAuthnConfig, parseStoredWebAuthnCredential } from './webauthn';

const ENV_KEYS = [
  'WEBAUTHN_ORIGIN',
  'NEXT_PUBLIC_APP_ORIGIN',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_RP_NAME',
] as const;

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('webauthn helpers', () => {
  const originalEnv = snapshotEnv();

  beforeEach(() => {
    restoreEnv(originalEnv);
  });

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it('prefers the actual forwarded request origin for tunnel and mobile traffic', () => {
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
    process.env.WEBAUTHN_RP_NAME = 'Smart Attendance';

    const request = new Request('https://example.com/api/webauthn/register/options', {
      headers: {
        'x-forwarded-host': 'happy-nights-study.loca.lt',
        'x-forwarded-proto': 'https',
      },
    });

    const config = getWebAuthnConfig(request);

    expect(config.origin).toBe('https://happy-nights-study.loca.lt');
    expect(config.rpID).toBe('happy-nights-study.loca.lt');
    expect(config.rpName).toBe('Smart Attendance');
  });

  it('falls back to configured origin when no request origin is available', () => {
    process.env.WEBAUTHN_ORIGIN = 'https://attendance.example.com';
    process.env.WEBAUTHN_RP_ID = 'attendance.example.com';

    const config = getWebAuthnConfig();

    expect(config.origin).toBe('https://attendance.example.com');
    expect(config.rpID).toBe('attendance.example.com');
  });

  it('ignores a localhost RP ID when the request comes from a public HTTPS origin', () => {
    process.env.WEBAUTHN_RP_ID = 'localhost';

    const request = new Request('https://smart-attendance-ecru-nu.vercel.app/api/webauthn/register/options', {
      headers: {
        'x-forwarded-host': 'smart-attendance-ecru-nu.vercel.app',
        'x-forwarded-proto': 'https',
      },
    });

    const config = getWebAuthnConfig(request);

    expect(config.origin).toBe('https://smart-attendance-ecru-nu.vercel.app');
    expect(config.rpID).toBe('smart-attendance-ecru-nu.vercel.app');
  });

  it('parses stored credentials safely', () => {
    expect(
      parseStoredWebAuthnCredential({
        id: 'cred',
        publicKey: 'key',
        counter: 1,
        transports: ['internal', 'usb', 'bogus'],
      })
    ).toEqual({
      id: 'cred',
      publicKey: 'key',
      counter: 1,
      transports: ['internal', 'usb'],
    });
  });

  it('accepts legacy string counters in stored credentials', () => {
    expect(
      parseStoredWebAuthnCredential({
        id: 'cred',
        publicKey: 'key',
        counter: '7',
      })
    ).toEqual({
      id: 'cred',
      publicKey: 'key',
      counter: 7,
      transports: undefined,
    });
  });
});
