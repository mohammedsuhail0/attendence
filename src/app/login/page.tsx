'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const rawIdentifier = identifier.trim();
    if (!rawIdentifier) {
      setError('Please enter your Email or Roll Number');
      setLoading(false);
      return;
    }

    if (!password) {
      setError('Please enter your password');
      setLoading(false);
      return;
    }

    const supabase = createClient();

    try {
      // Primary: authenticate through server-side /api/auth/login
      // This bypasses client-side ISP DNS sinkholes/ECONNRESET and sets cookies via @supabase/ssr
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: rawIdentifier, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // Synchronize session to browser client so client calls immediately have user context
        if (data.session) {
          try {
            await supabase.auth.setSession(data.session);
          } catch (syncErr) {
            console.warn('Session client sync notice:', syncErr);
          }
        }
        window.location.assign(data.destination || '/teacher');
        return;
      }

      // If server returned an explicit error (e.g. invalid credentials)
      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }

      // Fallback: client-side signInWithPassword
      let loginEmail = rawIdentifier;
      if (!rawIdentifier.includes('@')) {
        const resolveRes = await fetch('/api/auth/resolve-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: rawIdentifier.replace(/\s+/g, '') }),
        });
        const resolveData = await resolveRes.json().catch(() => ({}));
        if (resolveData.email) {
          loginEmail = resolveData.email;
        }
      }

      const { error: clientAuthError } = await supabase.auth.signInWithPassword({
        email: loginEmail.toLowerCase(),
        password,
      });

      if (clientAuthError) {
        setError(clientAuthError.message || 'Invalid credentials. Please check your email/roll number and password.');
        setLoading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Login failed. Please try again.');
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const destination =
        profile?.role === 'teacher'
          ? '/teacher'
          : profile?.role === 'admin'
            ? '/admin'
            : '/student';

      window.location.assign(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error during sign in. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="login-wrapper">
      <main className="signin-phone" role="main" aria-label="Nova Class sign in">
        <div className="signin-glow signin-glow-top" aria-hidden="true" />
        <div className="signin-glow signin-glow-bottom" aria-hidden="true" />

        <header className="signin-brand-row">
          <h1>Nova Class</h1>
        </header>

        <p className="signin-pill">
          <span className="signin-pill-dot" /> Smart Attendance System
        </p>

        <section className="signin-hero">
          <h2>
            Welcome
            <br />
            back, <em>scholar.</em>
          </h2>
          <p>Sign in to continue tracking attendance seamlessly.</p>
        </section>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="signin-form">
          <div className="form-group">
            <label htmlFor="identifier">Email or Roll Number</label>
            <input
              id="identifier"
              type="text"
              className="signin-input"
              placeholder="you@college.edu or 160524737018"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="signin-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="signin-submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </main>
    </div>
  );
}
