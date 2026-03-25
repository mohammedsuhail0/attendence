const FALLBACK_SUPABASE_URL = 'https://example.supabase.co';
const FALLBACK_SUPABASE_KEY = 'placeholder-key';

export function getSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || FALLBACK_SUPABASE_KEY,
  };
}

