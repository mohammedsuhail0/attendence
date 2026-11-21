import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/utils';
import { findDemoUser, DEMO_PASSWORD } from '@/lib/demo-fallback';

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
    let email = identifier.trim();

    // Try standard Supabase authentication first
    let supabaseWorks = false;
    try {
      const admin = createAdminClient();

      // If identifier is a roll number (no '@'), resolve it to email
      if (!email.includes('@')) {
        const normalizedRoll = email.replace(/\s+/g, '');
        const { data: profile } = await admin
          .from('profiles')
          .select('email')
          .ilike('roll_number', normalizedRoll)
          .maybeSingle();

        if (profile?.email) {
          email = profile.email;
        }
      }

      email = email.toLowerCase().trim();

      // Sign in through Supabase SSR server client which sets session cookies on response
      const supabase = await createClient();
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (!authError && authData?.user) {
        supabaseWorks = true;
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
      }
    } catch {
      // Supabase is down, paused, or unreachable (e.g. DNS ENOTFOUND or network timeout)
      supabaseWorks = false;
    }

    // Emergency Offline Demo Fallback: If Supabase is down/paused or credentials match demo
    const demoUser = findDemoUser(identifier);
    if (demoUser && password === DEMO_PASSWORD) {
      const cookieStore = await cookies();
      const sessionPayload = {
        id: demoUser.id,
        email: demoUser.email,
        role: demoUser.role,
        full_name: demoUser.full_name,
        department: demoUser.department,
        section: demoUser.section,
        roll_number: demoUser.roll_number || null,
        isDemo: true,
      };

      cookieStore.set('nova_demo_auth', JSON.stringify(sessionPayload), {
        httpOnly: true,
        path: '/',
        maxAge: 86400 * 7,
        sameSite: 'lax',
      });

      return NextResponse.json({
        success: true,
        destination: getDashboardByRole(demoUser.role),
        user: { id: demoUser.id, email: demoUser.email },
        session: { access_token: 'demo-session-token', user: { id: demoUser.id, email: demoUser.email } },
        profile: demoUser,
        isOfflineDemo: true,
        notice: 'Authenticated via Resilient Offline Demo Mode (Supabase paused or restoring).',
      });
    }

    return NextResponse.json(
      { error: 'Invalid credentials. Please check your email/roll number and password.' },
      { status: 401 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
