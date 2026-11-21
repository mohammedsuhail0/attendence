import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CANONICAL_CURRICULUM } from '@/lib/curriculum';
import type { Class } from '@/types/database';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const demoCookie = cookieStore.get('nova_demo_auth')?.value;
    let demoUser = null;
    if (demoCookie) {
      try {
        demoUser = JSON.parse(demoCookie);
      } catch {
        // ignore
      }
    }

    let user = null;
    try {
      const supabase = await createClient();
      const userRes = await supabase.auth.getUser();
      user = userRes.data?.user;
    } catch {
      // Supabase is down / paused
    }

    if (!user && !demoUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    let dbClasses: Class[] = [];
    let profileData = demoUser
      ? { full_name: demoUser.full_name, role: demoUser.role, department: demoUser.department }
      : null;

    if (user) {
      try {
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

        if (profileRes.data) {
          profileData = profileRes.data;
        }
        if (classesRes.data) {
          dbClasses = classesRes.data as Class[];
        }
      } catch {
        // Fallback to canonical
      }
    }

    let classes: Class[] = [];
    if (dbClasses.length > 0) {
      const seen = new Set(dbClasses.map((c) => `${c.department}-${c.section}-${c.subject.toLowerCase()}`));
      const missingCanonical = CANONICAL_CURRICULUM.filter(
        (c) => !seen.has(`${c.department}-${c.section}-${c.subject.toLowerCase()}`)
      );
      classes = [...dbClasses, ...missingCanonical];
    } else {
      classes = [...CANONICAL_CURRICULUM];
    }

    return NextResponse.json({
      classes,
      profile: profileData,
      isOfflineDemo: !user && !!demoUser,
    });
  } catch {
    return NextResponse.json({
      classes: CANONICAL_CURRICULUM,
      profile: null,
      isOfflineDemo: true,
    });
  }
}
