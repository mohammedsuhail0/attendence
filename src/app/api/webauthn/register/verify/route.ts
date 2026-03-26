import { NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getWebAuthnConfig } from '@/lib/webauthn';

const VerifyRegistrationSchema = z.object({
  response: z.unknown(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, webauthn_challenge')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'student') {
      return NextResponse.json({ error: 'Only students can verify biometrics' }, { status: 403 });
    }

    if (!profile.webauthn_challenge) {
      return NextResponse.json(
        { error: 'No pending biometric challenge. Try again.' },
        { status: 400 }
      );
    }

    const body = VerifyRegistrationSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const response = body.data.response as Parameters<
      typeof verifyRegistrationResponse
    >[0]['response'];

    const { origin, rpID } = getWebAuthnConfig(request);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: profile.webauthn_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Biometric verification failed' }, { status: 401 });
    }

    const transportsCandidate = (response as { response?: { transports?: unknown } }).response
      ?.transports;
    const transports = Array.isArray(transportsCandidate)
      ? transportsCandidate.filter((item): item is string => typeof item === 'string')
      : undefined;

    const credential = {
      id: verification.registrationInfo.credentialID,
      publicKey: isoBase64URL.fromBuffer(verification.registrationInfo.credentialPublicKey),
      counter: verification.registrationInfo.counter,
      transports,
    };

    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from('profiles')
      .update({
        webauthn_credential: credential,
        webauthn_challenge: null,
      })
      .eq('id', user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Biometric registered' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('WebAuthn register verify failed:', error);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
      },
      { status: 500 }
    );
  }
}
