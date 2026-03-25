'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { Class, AttendanceSession } from '@/types/database';

export default function TeacherDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [classes, setClasses] = useState<Class[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [profile, setProfile] = useState<{ full_name: string } | null>(null);

  // Form state
  const [selectedClass, setSelectedClass] = useState('');
  const [period, setPeriod] = useState(1);
  const [sessionDate, setSessionDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  // Active session state
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [token, setToken] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [attendanceList, setAttendanceList] = useState<
    { status: string; profiles: { full_name: string; roll_number: string } }[]
  >([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch profile, classes, sessions
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      setProfile(p);

      const res1 = await fetch('/api/classes');
      const d1 = await res1.json();
      if (d1.classes) setClasses(d1.classes);

      const res2 = await fetch('/api/sessions');
      const d2 = await res2.json();
      if (d2.sessions) setSessions(d2.sessions);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer
  const startTimer = useCallback((expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);

    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(diff);
      if (diff <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    update();
    timerRef.current = setInterval(update, 1000);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Poll attendance list for active session
  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed') return;

    const poll = async () => {
      const res = await fetch(`/api/sessions/${activeSession.id}/attendance`);
      const data = await res.json();
      if (data.records) setAttendanceList(data.records);
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [activeSession]);

  // Create session
  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        class_id: selectedClass,
        period,
        session_date: sessionDate,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Failed to create session');
      return;
    }

    setActiveSession(data.session);
    setToken(data.session.token);
    startTimer(data.session.token_expires_at);
    setSuccess('Session created! Share the token with students.');
  }

  // Refresh token
  async function refreshToken() {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${activeSession.id}/refresh`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok) {
      setToken(data.token);
      startTimer(data.token_expires_at);
    }
  }

  // Close session
  async function closeSession() {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${activeSession.id}/close`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok) {
      setActiveSession(null);
      setToken('');
      setTimeLeft(0);
      setSuccess(`Session closed. Present: ${data.present}, Absent: ${data.absent}`);
      // Refresh sessions list
      const res2 = await fetch('/api/sessions');
      const d2 = await res2.json();
      if (d2.sessions) setSessions(d2.sessions);
    }
  }

  // Logout
  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Teacher Dashboard</h1>
          <span className="user-info">{profile?.full_name}</span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout}>
          Sign Out
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Active Session */}
      {activeSession && (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-header">
            <h2>🟢 Active Session</h2>
            <span className="badge badge-active">LIVE</span>
          </div>

          <div className="token-display">
            <p className="text-dim text-sm">Share this token with students</p>
            <div className="token-code">{token}</div>
            <p className={`token-timer ${timeLeft > 0 ? 'active' : 'expired'}`}>
              {timeLeft > 0 ? `⏱ ${timeLeft}s remaining` : '⚠ Token expired'}
            </p>
          </div>

          <div className="flex-between mt-2">
            <button className="btn btn-primary btn-sm" onClick={refreshToken}>
              🔄 New Token
            </button>
            <button className="btn btn-danger btn-sm" onClick={closeSession}>
              ✖ Close Session
            </button>
          </div>

          {/* Live Attendance */}
          {attendanceList.length > 0 && (
            <div className="mt-3">
              <h3>Attendance ({attendanceList.filter(a => a.status === 'present').length} present)</h3>
              <div className="table-wrapper mt-1">
                <table>
                  <thead>
                    <tr>
                      <th>Roll No</th>
                      <th>Name</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceList.map((r, i) => (
                      <tr key={i}>
                        <td>{r.profiles?.roll_number || '—'}</td>
                        <td>{r.profiles?.full_name || '—'}</td>
                        <td>
                          <span className={`badge badge-${r.status}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Session Form */}
      {!activeSession && (
        <div className="card">
          <h2>Start New Session</h2>
          <form onSubmit={createSession} className="mt-2">
            <div className="form-group">
              <label htmlFor="class-select">Class</label>
              <select
                id="class-select"
                className="form-select"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                required
              >
                <option value="">Select a class...</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.department} — {c.section} — {c.subject}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="period">Period</label>
                <select
                  id="period"
                  className="form-select"
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                    <option key={p} value={p}>Period {p}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="session-date">Date</label>
                <input
                  id="session-date"
                  type="date"
                  className="form-input"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || !selectedClass}
            >
              {loading ? 'Creating...' : 'Start Session & Generate Token'}
            </button>
          </form>
        </div>
      )}

      {/* Session History */}
      <div className="card mt-3">
        <h2>Session History</h2>
        {sessions.length === 0 ? (
          <p className="text-dim text-sm mt-1">No sessions yet</p>
        ) : (
          <div className="table-wrapper mt-1">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Subject</th>
                  <th>Period</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.session_date}</td>
                    <td>{s.classes?.subject || '—'}</td>
                    <td>P{s.period}</td>
                    <td>
                      <span className={`badge badge-${s.status}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
