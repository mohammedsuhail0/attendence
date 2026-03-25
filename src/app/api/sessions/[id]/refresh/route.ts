import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateToken, TOKEN_VALIDITY_SECONDS } from '@/lib/utils';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify ownership
    const { data: session } = await supabase
      .from('attendance_sessions')
      .select('id, status, teacher_id')
      .eq('id', id)
      .eq('teacher_id', user.id)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'closed') {
      return NextResponse.json({ error: 'Session is closed' }, { status: 400 });
    }

    // Generate new token
    const token = generateToken();
    const tokenExpiresAt = new Date(Date.now() + TOKEN_VALIDITY_SECONDS * 1000).toISOString();

    const admin = createAdminClient();
    const { error } = await admin
      .from('attendance_sessions')
      .update({ token, token_expires_at: tokenExpiresAt })
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ token, token_expires_at: tokenExpiresAt });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
