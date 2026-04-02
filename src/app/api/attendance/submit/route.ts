import { NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SubmitAttendanceSchema } from '@/lib/schemas/attendance';
import { rateLimit, isTokenExpired } from '@/lib/utils';
import { getWebAuthnConfig, parseStoredWebAuthnCredential } from '@/lib/webauthn';

export async function POST(request: Request) {
  try {
    // Rate limit by IP
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const { allowed } = rateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in a minute.' },
        { status: 429 }
      );
    }

    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, webauthn_credential, webauthn_challenge')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'student') {
      return NextResponse.json({ error: 'Only students can submit attendance' }, { status: 403 });
    }

    // Validate input
    const body = await request.json();
    const parsed = SubmitAttendanceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid token format', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { token, assertion } = parsed.data;
    const admin = createAdminClient();

    // Find active session with this token
    const { data: session } = await admin
      .from('attendance_sessions')
      .select('*')
      .eq('token', token)
      .eq('status', 'active')
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 });
    }

    // Check token expiry
    if (isTokenExpired(session.token_expires_at)) {
      return NextResponse.json({ error: 'Token has expired' }, { status: 410 });
    }

    // Check if student is enrolled in this class
    const { data: enrollment } = await admin
      .from('enrollments')
      .select('id')
      .eq('student_id', user.id)
      .eq('class_id', session.class_id)
      .single();

    if (!enrollment) {
      return NextResponse.json(
        { error: 'You are not enrolled in this class' },
        { status: 403 }
      );
    }

    // Check for duplicate submission
    const { data: existing } = await admin
      .from('attendance_records')
      .select('id')
      .eq('session_id', session.id)
      .eq('student_id', user.id)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Attendance already marked' }, { status: 409 });
    }

    // Biometric verification is mandatory before attendance marking
    const storedCredential = parseStoredWebAuthnCredential(profile.webauthn_credential);
    if (!storedCredential) {
      return NextResponse.json(
        { error: 'Biometric is not set up for this account' },
        { status: 412 }
      );
    }

    if (!profile.webauthn_challenge) {
      return NextResponse.json(
        { error: 'Biometric challenge missing. Please retry attendance.' },
        { status: 400 }
      );
    }

    const biometricResponse = assertion as Parameters<
      typeof verifyAuthenticationResponse
    >[0]['response'];

    const { origin, rpID } = getWebAuthnConfig(request);
    const biometricVerification = await verifyAuthenticationResponse({
      response: biometricResponse,
      expectedChallenge: profile.webauthn_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: storedCredential.id,
        credentialPublicKey: isoBase64URL.toBuffer(storedCredential.publicKey),
        counter: storedCredential.counter,
        transports: storedCredential.transports,
      },
    });

    if (!biometricVerification.verified) {
      return NextResponse.json(
        { error: 'Biometric verification failed' },
        { status: 401 }
      );
    }

    const updatedCredential = {
      ...storedCredential,
      counter: biometricVerification.authenticationInfo.newCounter,
    };

    const { error: credentialUpdateError } = await admin
      .from('profiles')
      .update({
        webauthn_credential: updatedCredential,
        webauthn_challenge: null,
      })
      .eq('id', user.id);

    if (credentialUpdateError) {
      return NextResponse.json({ error: credentialUpdateError.message }, { status: 500 });
    }

    // Mark present
    const { error } = await admin
      .from('attendance_records')
      .insert({
        session_id: session.id,
        student_id: user.id,
        status: 'present',
        mark_mode: 'biometric',
      });

    if (error) {
      const isLegacySchema = String(error.message).includes('mark_mode');
      if (isLegacySchema) {
        const { error: fallbackError } = await admin
          .from('attendance_records')
          .insert({
            session_id: session.id,
            student_id: user.id,
            status: 'present',
          });
        if (fallbackError) {
          return NextResponse.json({ error: fallbackError.message }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ message: 'Attendance marked successfully' }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
