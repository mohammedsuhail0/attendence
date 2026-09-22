import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CANONICAL_CURRICULUM } from '@/lib/curriculum';
import type { Class } from '@/types/database';

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

    let classes: Class[] = [];

    if (!classesRes.error && Array.isArray(classesRes.data) && classesRes.data.length > 0) {
      // Merge DB classes with canonical curriculum to ensure no department or year is missing
      const dbClasses = classesRes.data as Class[];
      const seen = new Set(dbClasses.map((c) => `${c.department}-${c.section}-${c.subject.toLowerCase()}`));
      const missingCanonical = CANONICAL_CURRICULUM.filter(
        (c) => !seen.has(`${c.department}-${c.section}-${c.subject.toLowerCase()}`)
      );
      classes = [...dbClasses, ...missingCanonical];
    } else {
      // Fallback directly to canonical curriculum if DB is empty or unreachable
      classes = [...CANONICAL_CURRICULUM];
    }

    return NextResponse.json({
      classes,
      profile: profileRes.data || null,
    });
  } catch {
    // Resilient fallback even on unhandled network exception
    return NextResponse.json({
      classes: CANONICAL_CURRICULUM,
      profile: null,
    });
  }
}
