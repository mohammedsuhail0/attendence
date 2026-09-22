import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/utils';

const LoginSchema = z.object({
  identifier: z.string().trim().min(1, 'Please enter your email or roll number'),
  password: z.string().min(1, 'Please enter your password'),
});

function getDashboardByRole(role: string | undefined | null) {
  if (role === 'teacher') return '/teacher';
  if (role === 'admin') return '/admin';
  return '/student';
}

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const { allowed } = rateLimit(`auth-login:${ip}`);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait a moment.' },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
      return NextResponse.json(
        { error: firstError || 'Email/roll number and password are required' },
        { status: 400 }
      );
    }

    const { identifier, password } = parsed.data;
    const admin = createAdminClient();
    let email = identifier.trim();

    // If identifier is a roll number (no '@'), resolve it to email
    if (!email.includes('@')) {
      const normalizedRoll = email.replace(/\s+/g, '');
      const { data: profile } = await admin
        .from('profiles')
        .select('email')
        .ilike('roll_number', normalizedRoll)
        .maybeSingle();

      if (!profile?.email) {
        return NextResponse.json(
          { error: 'Invalid credentials. Please check your roll number and password.' },
          { status: 401 }
        );
      }
      email = profile.email;
    }

    email = email.toLowerCase().trim();

    // Sign in through Supabase SSR server client which sets session cookies on response
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData?.user) {
      const isInvalid =
        authError?.message?.toLowerCase().includes('invalid login credentials') ||
        authError?.message?.toLowerCase().includes('invalid');
      return NextResponse.json(
        {
          error: isInvalid
            ? 'Invalid credentials. Please check your email/roll number and password.'
            : (authError?.message || 'Login failed. Please try again.'),
        },
        { status: 401 }
      );
    }

    // Retrieve user profile with admin client to determine redirect role
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, full_name, role, roll_number, department')
      .eq('id', authData.user.id)
      .maybeSingle();

    const destination = getDashboardByRole(profile?.role);

    return NextResponse.json({
      success: true,
      destination,
      user: authData.user,
      session: authData.session,
      profile: profile || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
