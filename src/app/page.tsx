import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

function getDashboardByRole(role: string | undefined) {
  if (role === 'teacher') return '/teacher';
  if (role === 'admin') return '/admin';
  return '/student';
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  redirect(getDashboardByRole(profile?.role));
}
