import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWebAuthnConfig, parseStoredWebAuthnCredential } from '@/lib/webauthn';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, webauthn_credential')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'student') {
      return NextResponse.json({ error: 'Only students can use biometric auth' }, { status: 403 });
    }

    const credential = parseStoredWebAuthnCredential(profile.webauthn_credential);
    if (!credential) {
      return NextResponse.json(
        { error: 'Biometric not set up. Register first.' },
        { status: 412 }
      );
    }

    const { rpID } = getWebAuthnConfig(request);
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [
        {
          id: credential.id,
          // Keep authenticator discovery aligned with how this credential was registered.
          transports: credential.transports?.length ? credential.transports : undefined,
        },
      ],
      userVerification: 'required',
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
    console.error('WebAuthn authenticate options failed:', error);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
      },
      { status: 500 }
    );
  }
}
