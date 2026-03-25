export interface StoredWebAuthnCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: WebAuthnTransport[];
}

const WEB_AUTHN_TRANSPORTS = [
  'ble',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
] as const;

export type WebAuthnTransport = (typeof WEB_AUTHN_TRANSPORTS)[number];

function isWebAuthnTransport(value: string): value is WebAuthnTransport {
  return (WEB_AUTHN_TRANSPORTS as readonly string[]).includes(value);
}

function getRequestOrigin(request?: Request): string | null {
  if (!request) return null;

  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host');
  if (!host) return null;

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProto || 'http';

  return `${protocol}://${host}`;
}

export function getWebAuthnConfig(request?: Request): {
  rpID: string;
  rpName: string;
  origin: string;
} {
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN;
  const fallbackOrigin = getRequestOrigin(request) || 'http://localhost:3000';
  const originString = configuredOrigin || fallbackOrigin;

  const originURL = new URL(originString);
  const rpID = process.env.WEBAUTHN_RP_ID || originURL.hostname;
  const rpName = process.env.WEBAUTHN_RP_NAME || 'Smart Attendance';

  return {
    rpID,
    rpName,
    origin: originURL.origin,
  };
}

export function parseStoredWebAuthnCredential(
  value: unknown
): StoredWebAuthnCredential | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as {
    id?: unknown;
    publicKey?: unknown;
    counter?: unknown;
    transports?: unknown;
  };

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.publicKey !== 'string' ||
    typeof candidate.counter !== 'number'
  ) {
    return null;
  }

  const transports = Array.isArray(candidate.transports)
    ? candidate.transports.filter(
        (item): item is WebAuthnTransport =>
          typeof item === 'string' && isWebAuthnTransport(item)
      )
    : undefined;

  return {
    id: candidate.id,
    publicKey: candidate.publicKey,
    counter: candidate.counter,
    transports,
  };
}
