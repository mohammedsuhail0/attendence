import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Unauthenticated users: redirect to login (except login page and API)
  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/api')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Authenticated users on login page: redirect to dashboard
  if (user && pathname.startsWith('/login')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const url = request.nextUrl.clone();
    url.pathname = profile?.role === 'teacher' ? '/teacher' : '/student';
    return NextResponse.redirect(url);
  }

  // Role-based route protection
  if (user && (pathname.startsWith('/teacher') || pathname.startsWith('/student'))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (pathname.startsWith('/teacher') && profile?.role !== 'teacher') {
      const url = request.nextUrl.clone();
      url.pathname = '/student';
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/student') && profile?.role !== 'student') {
      const url = request.nextUrl.clone();
      url.pathname = '/teacher';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
