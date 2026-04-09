import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/utils';
import { createHash } from 'node:crypto';

const ResolveLoginSchema = z.object({
  identifier: z.string().trim().min(1),
});

function fallbackEmailForIdentifier(identifier: string) {
  const hash = createHash('sha256').update(identifier).digest('hex').slice(0, 16);
  return `${hash}@invalid.classnova.local`;
}

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const { allowed } = rateLimit(`resolve-login:${ip}`);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
    }

    const parsed = ResolveLoginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const identifier = parsed.data.identifier.trim();
    const normalized = identifier.replace(/\s+/g, '');

    if (identifier.includes('@')) {
      return NextResponse.json({ email: identifier.toLowerCase() });
    }

    const admin = createAdminClient();
    const { data: profile, error } = await admin
      .from('profiles')
      .select('email')
      .eq('roll_number', normalized)
      .maybeSingle();

    // Return a stable shape and avoid exposing whether roll number exists.
    if (error) {
      return NextResponse.json({ email: fallbackEmailForIdentifier(normalized) });
    }

    return NextResponse.json({
      email: profile?.email || fallbackEmailForIdentifier(normalized),
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
