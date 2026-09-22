import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    const [profileRes, classesRes] = await Promise.all([
      admin
        .from('profiles')
        .select('full_name, role, department')
        .eq('id', user.id)
        .single(),
      admin
        .from('classes')
        .select('*')
        .order('department', { ascending: true })
        .order('section', { ascending: true })
        .order('subject', { ascending: true }),
    ]);

    if (classesRes.error) {
      return NextResponse.json({ error: classesRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      classes: classesRes.data || [],
      profile: profileRes.data || null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
