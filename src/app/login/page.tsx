'use client';

import { useState } from 'react';
import Image from 'next/image';
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

    const supabase = createClient();
    const rawIdentifier = identifier.trim();
    const normalizedIdentifier = rawIdentifier.includes('@')
      ? rawIdentifier.toLowerCase()
      : rawIdentifier.replace(/\s+/g, '');

    let loginEmail = normalizedIdentifier;
    if (!normalizedIdentifier.includes('@')) {
      const resolveRes = await fetch('/api/auth/resolve-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: normalizedIdentifier }),
      });

      const resolveData = await resolveRes.json().catch(() => ({}));
      if (!resolveRes.ok) {
        setError(resolveData.error || 'Unable to process login request');
        setLoading(false);
        return;
      }

      loginEmail = String(resolveData.email).toLowerCase();
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (authError) {
      setError('Invalid credentials');
      setLoading(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError('Login failed');
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    const destination =
      profile?.role === 'teacher'
        ? '/teacher'
        : profile?.role === 'admin'
          ? '/admin'
          : '/student';

    // A full navigation is more reliable immediately after auth changes.
    window.location.assign(destination);
  }

  return (
    <div className="login-wrapper">
      <main className="signin-phone" role="main" aria-label="Nova Class sign in">
        <div className="signin-glow signin-glow-top" aria-hidden="true" />
        <div className="signin-glow signin-glow-bottom" aria-hidden="true" />

        <header className="signin-brand-row">
          <Image
            src="/images/nova-class-logo.png"
            alt="Nova Class logo"
            className="signin-logo-image"
            width={78}
            height={78}
            priority
          />
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
