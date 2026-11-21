import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function getDashboardByRole(role: string | undefined | null) {
  if (role === 'teacher') return '/teacher';
  if (role === 'admin') return '/admin';
  return '/student';
}

function parseDemoCookie(request: NextRequest) {
  try {
    const raw = request.cookies.get('nova_demo_auth')?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.id && parsed.role) {
      return parsed;
    }
  } catch {
    // Ignore invalid json
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApiPath = pathname.startsWith('/api');
  const isPublicApiPath =
    pathname === '/api/auth/resolve-login' || pathname === '/api/auth/login';
  const isPublicPath =
    pathname === '/' || pathname.startsWith('/login') || isPublicApiPath;

  // 1. Check if Offline Demo Session Cookie is present
  const demoUser = parseDemoCookie(request);
  if (demoUser) {
    // If on login page, redirect to dashboard
    if (pathname.startsWith('/login')) {
      const url = request.nextUrl.clone();
      url.pathname = getDashboardByRole(demoUser.role);
      return NextResponse.redirect(url);
    }

    // Role-based route guard for demo session
    if (pathname.startsWith('/teacher') && demoUser.role !== 'teacher') {
      const url = request.nextUrl.clone();
      url.pathname = getDashboardByRole(demoUser.role);
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/student') && demoUser.role !== 'student') {
      const url = request.nextUrl.clone();
      url.pathname = getDashboardByRole(demoUser.role);
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/admin') && demoUser.role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = getDashboardByRole(demoUser.role);
      return NextResponse.redirect(url);
    }

    // Allow access to protected routes & APIs under demo session
    return NextResponse.next({ request });
  }

  // 2. Fall back to standard Supabase Auth
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isApiPath && !isPublicApiPath) {
      return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
    }
    if (!isPublicPath) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Unauthenticated users: redirect to login for protected routes only.
    if (!user && !isPublicPath) {
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
      url.pathname = getDashboardByRole(profile?.role);
      return NextResponse.redirect(url);
    }

    // Role-based route protection
    if (
      user &&
      (pathname.startsWith('/teacher') ||
        pathname.startsWith('/student') ||
        pathname.startsWith('/admin'))
    ) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (pathname.startsWith('/teacher') && profile?.role !== 'teacher') {
        const url = request.nextUrl.clone();
        url.pathname = getDashboardByRole(profile?.role);
        return NextResponse.redirect(url);
      }
      if (pathname.startsWith('/student') && profile?.role !== 'student') {
        const url = request.nextUrl.clone();
        url.pathname = getDashboardByRole(profile?.role);
        return NextResponse.redirect(url);
      }
      if (pathname.startsWith('/admin') && profile?.role !== 'admin') {
        const url = request.nextUrl.clone();
        url.pathname = getDashboardByRole(profile?.role);
        return NextResponse.redirect(url);
      }
    }

    return supabaseResponse;
  } catch {
    // Supabase network failure / pause
    if (isApiPath && !isPublicApiPath) {
      return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
    }
    if (!isPublicPath) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
