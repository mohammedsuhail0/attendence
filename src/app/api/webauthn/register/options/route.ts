import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWebAuthnConfig } from '@/lib/webauthn';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, email, webauthn_credential')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'student') {
      return NextResponse.json({ error: 'Only students can register biometrics' }, { status: 403 });
    }

    if (profile.webauthn_credential) {
      return NextResponse.json(
        { error: 'Biometric is already registered' },
        { status: 409 }
      );
    }

    const { rpID, rpName } = getWebAuthnConfig(request);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: profile.email || user.email || user.id,
      userDisplayName: profile.full_name || profile.email || 'Student',
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from('profiles')
      .update({ webauthn_challenge: options.challenge })
      .eq('id', user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('WebAuthn register options failed:', error);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
      },
      { status: 500 }
    );
  }
}
