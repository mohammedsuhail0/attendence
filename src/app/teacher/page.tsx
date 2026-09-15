'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import Image from 'next/image';
import type { Class, AttendanceSession } from '@/types/database';
import { getDateStringInTimeZone } from '@/lib/utils';

const DEPARTMENT_OPTIONS = ['IT', 'CSE', 'AIDS', 'Civil', 'Mech'] as const;
const YEAR_OPTIONS = ['1', '2', '3', '4'] as const;

function getClassYear(cls: Class) {
  return cls.section === 'A' ? '1' : cls.section;
}

interface StudentRosterItem {
  student_id: string;
  full_name: string;
  roll_number: string;
  email: string;
  photo_path: string | null;
  photo_url: string | null;
  attendance_status: string;
}

export default function TeacherDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [classes, setClasses] = useState<Class[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [profile, setProfile] = useState<{ full_name: string } | null>(null);
  const [today, setToday] = useState(() => getDateStringInTimeZone());

  const [selectedDepartment, setSelectedDepartment] = useState('IT');
  const [selectedYear, setSelectedYear] = useState('1');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [period, setPeriod] = useState(1);

  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [token, setToken] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [hudMode, setHudMode] = useState<'token' | 'qr'>('token');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  const [roster, setRoster] = useState<StudentRosterItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [listVisible, setListVisible] = useState(true);
  const [overrideLoading, setOverrideLoading] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync today date
  useEffect(() => {
    const syncToday = () => setToday(getDateStringInTimeZone());
    syncToday();
    const interval = setInterval(syncToday, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Generate QR Code data URL whenever token changes
  const generateQR = useCallback(async (tokenVal: string) => {
    if (!tokenVal) return;
    try {
      const studentUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/student?token=${encodeURIComponent(tokenVal)}`
        : `https://smart-attendance-ecru-nu.vercel.app/student?token=${tokenVal}`;
      
      const url = await QRCode.toDataURL(studentUrl, {
        width: 260,
        margin: 1.5,
        color: {
          dark: '#0f6a4b',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H',
      });
      setQrCodeDataUrl(url);
    } catch (err) {
      console.error('Failed to generate QR code', err);
    }
  }, []);

  const startTimer = useCallback((expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);

    const update = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setTimeLeft(diff);
      if (diff <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
      }
    };

    update();
    timerRef.current = setInterval(update, 1000);
  }, []);

  // Initial load
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      setProfile(p);

      const res1 = await fetch('/api/classes');
      const d1 = await res1.json();
      if (d1.classes) {
        setClasses(d1.classes);
        const first = d1.classes[0];
        if (first) {
          setSelectedDepartment(first.department);
          setSelectedYear(getClassYear(first));
          setSelectedSubject(first.subject);
        }
      }

      const res2 = await fetch('/api/sessions');
      const d2 = await res2.json();
      if (d2.sessions) {
        setSessions(d2.sessions);
        const active = d2.sessions.find((s: AttendanceSession) => s.status === 'active');
        if (active) {
          setActiveSession(active);
          setToken(active.token);
          generateQR(active.token);
          startTimer(active.token_expires_at);
        }
      }
    }

    load();
  }, [supabase, router, generateQR, startTimer]);

  // Clean timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Filter subjects based on department & year
  const subjects = Array.from(
    new Set(
      classes
        .filter(
          (cls) =>
            cls.department === selectedDepartment &&
            getClassYear(cls) === selectedYear
        )
        .map((cls) => cls.subject)
    )
  ).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (subjects.length > 0 && !subjects.includes(selectedSubject)) {
      setSelectedSubject(subjects[0]);
    }
  }, [selectedDepartment, selectedYear, subjects, selectedSubject]);

  // Fetch roster and records for active session
  const fetchRoster = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/manual-override`);
      const data = await res.json();
      if (res.ok && data.students) {
        setRoster(data.students);
      }
    } catch (e) {
      console.error('Error fetching roster:', e);
    }
  }, []);

  // Live polling when session is active
  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed') return;

    fetchRoster(activeSession.id);
    const interval = setInterval(() => {
      fetchRoster(activeSession.id);
    }, 3000);

    return () => clearInterval(interval);
  }, [activeSession, fetchRoster]);

  // Start new attendance session
  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const selectedClass = classes.find(
      (cls) =>
        cls.department === selectedDepartment &&
        getClassYear(cls) === selectedYear &&
        cls.subject === selectedSubject
    );

    if (!selectedClass) {
      setLoading(false);
      setError('Please choose department, year, and subject.');
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_id: selectedClass.id,
          period: Number(period),
          session_date: today,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create session');
      }

      setActiveSession(data.session);
      setToken(data.session.token);
      generateQR(data.session.token);
      startTimer(data.session.token_expires_at);
      setSuccess('Session created! Students can scan QR or enter 4-digit code.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error creating session');
    } finally {
      setLoading(false);
    }
  }

  // Refresh token / Rotate QR
  async function refreshToken() {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/refresh`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
        generateQR(data.token);
        startTimer(data.token_expires_at);
        setActiveSession((prev) => (prev ? { ...prev, ...data } : null));
        setSuccess('Token refreshed & rotated.');
      }
    } catch {
      setError('Failed to refresh token');
    }
  }

  // Close session
  async function closeSession() {
    if (!activeSession) return;
    if (!confirm('Are you sure you want to close this session? Absent students will be auto-marked.')) return;

    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/close`, {
        method: 'POST',
      });
      if (res.ok) {
        setActiveSession(null);
        setToken('');
        setTimeLeft(0);
        if (timerRef.current) clearInterval(timerRef.current);
        setSuccess('Session closed successfully.');
        const res2 = await fetch('/api/sessions');
        const d2 = await res2.json();
        if (d2.sessions) setSessions(d2.sessions);
      }
    } catch {
      setError('Failed to close session');
    }
  }

  const [activeTab, setActiveTab] = useState<'broadcast' | 'roster' | 'history'>('broadcast');

  // Manual Override: 1-Tap mark present
  async function handleManualOverride(studentId: string) {
    if (!activeSession) return;
    setOverrideLoading(studentId);
    setError('');
    setSuccess('');
    try {
      setRoster((prev) =>
        prev.map((s) => (s.student_id === studentId ? { ...s, attendance_status: 'present' } : s))
      );

      const res = await fetch(`/api/sessions/${activeSession.id}/manual-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to override attendance');
      }

      await fetchRoster(activeSession.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Override failed');
      await fetchRoster(activeSession.id);
    } finally {
      setOverrideLoading(null);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const filteredRoster = roster.filter(
    (s) =>
      s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.roll_number.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const presentCount = roster.filter((s) => s.attendance_status === 'present').length;
  const totalCount = roster.length;

  return (
    <div className="mobile-app-shell">
      {/* Top Mobile Header Bar */}
      <header className="mobile-app-header">
        <div className="brand-header-wrap">
          <h1>Teacher Studio</h1>
          <span className="user-info">{profile?.full_name || 'Faculty'}</span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout} type="button">
          Sign Out
        </button>
      </header>

      {/* Main Tab Screen Content */}
      <main className={`mobile-app-content ${activeTab === 'broadcast' ? 'fit-screen' : ''}`}>
        {/* Banner Alerts */}
        {error && <div className="alert alert-error">⚠️ {error}</div>}
        {success && <div className="alert alert-success">✅ {success}</div>}

        {/* TAB 1: BROADCAST HUD (FIT SCREEN, ZERO SCROLL) */}
        {activeTab === 'broadcast' && (
          activeSession ? (
            <div className="flex-col gap-1 justify-between" style={{ height: '100%' }}>
              <div className="card" style={{ marginBottom: '0.5rem' }}>
                <div className="card-header">
                  <div className="flex items-center gap-1">
                    <span className="pulse-dot"></span>
                    <h2>Active Session</h2>
                  </div>
                  <span className="badge badge-present">LIVE</span>
                </div>

                <p className="text-dim text-sm text-center mb-1">
                  Period {activeSession.period} • {today}
                </p>

                {/* Switcher Pill: 4-Digit Token <-> Dynamic QR */}
                <div className="hud-switcher-pill">
                  <button
                    onClick={() => setHudMode('token')}
                    className={`hud-tab-btn ${hudMode === 'token' ? 'active' : ''}`}
                    type="button"
                  >
                    🔢 4-Digit PIN
                  </button>
                  <button
                    onClick={() => setHudMode('qr')}
                    className={`hud-tab-btn ${hudMode === 'qr' ? 'active' : ''}`}
                    type="button"
                  >
                    📱 Dynamic QR Code
                  </button>
                </div>

                {/* Main Broadcast Hero Display */}
                {hudMode === 'token' ? (
                  <div className="token-display">
                    <div className="text-sm text-dim">Share PIN with students</div>
                    <div className="token-code">{token || '••••'}</div>
                    <div className={`token-timer ${timeLeft > 0 ? 'active' : 'expired'}`}>
                      {timeLeft > 0 ? `⏳ ${timeLeft}s remaining` : '⚠️ Token expired'}
                    </div>
                  </div>
                ) : (
                  <div className="qr-display-box">
                    <div className="qr-card-white">
                      {qrCodeDataUrl ? (
                        <Image
                          src={qrCodeDataUrl}
                          alt="Attendance QR Code"
                          width={190}
                          height={190}
                          className="qr-img"
                          priority
                          unoptimized
                        />
                      ) : (
                        <div className="p-8 text-sm text-dim">Generating QR...</div>
                      )}
                    </div>
                    <div className={`token-timer ${timeLeft > 0 ? 'active' : 'expired'}`}>
                      <span className="pulse-dot"></span>
                      <span>Auto-rotates in {timeLeft}s</span>
                    </div>
                  </div>
                )}

                {/* Session Action Buttons */}
                <div className="grid-2">
                  <button
                    className="btn btn-primary btn-block"
                    onClick={refreshToken}
                    type="button"
                  >
                    🔄 New Token
                  </button>
                  <button
                    className="btn btn-danger btn-block"
                    onClick={closeSession}
                    type="button"
                  >
                    🛑 Close Session
                  </button>
                </div>
              </div>

              {/* Quick Status Bar */}
              <button
                type="button"
                className="btn btn-secondary btn-block flex-between"
                onClick={() => setActiveTab('roster')}
              >
                <span>👥 Live Roster</span>
                <span className="badge badge-present">{presentCount} / {totalCount} Present →</span>
              </button>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <h2>Start Attendance</h2>
                <span className="badge badge-active">{today}</span>
              </div>

              <form onSubmit={createSession}>
                <div className="form-group">
                  <label>Department</label>
                  <select
                    className="form-select"
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                  >
                    {DEPARTMENT_OPTIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Academic Year</label>
                  <select
                    className="form-select"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                  >
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y} value={y}>Year {y}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Subject</label>
                  <select
                    className="form-select"
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                  >
                    {subjects.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Period</label>
                  <select
                    className="form-select"
                    value={period}
                    onChange={(e) => setPeriod(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                      <option key={p} value={p}>Period {p}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block mt-2"
                  disabled={loading || !selectedSubject}
                >
                  {loading ? 'Creating Broadcast...' : '⚡ Launch Attendance Session'}
                </button>
              </form>
            </div>
          )
        )}

        {/* TAB 2: ROSTER OVERRIDE */}
        {activeTab === 'roster' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="card-header">
              <div>
                <h2>Live Roster</h2>
                <p className="card-meta">
                  {presentCount} / {totalCount} Students Present
                </p>
              </div>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => activeSession && fetchRoster(activeSession.id)}
                disabled={!activeSession}
                type="button"
              >
                🔄
              </button>
            </div>

            <div className="roster-search-box">
              <input
                type="text"
                placeholder="Search student by name or roll..."
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="roster-list" style={{ flex: 1, maxHeight: 'none' }}>
              {filteredRoster.map((s) => {
                const isPresent = s.attendance_status === 'present';
                return (
                  <div key={s.student_id} className="roster-row">
                    <div className="roster-student-meta">
                      {s.photo_url ? (
                        <Image
                          src={s.photo_url}
                          alt={s.full_name}
                          width={32}
                          height={32}
                          className="roster-avatar"
                          unoptimized
                        />
                      ) : (
                        <div className="roster-avatar-fallback">
                          {s.full_name.charAt(0) || 'S'}
                        </div>
                      )}
                      <div className="roster-name-col">
                        <div className="roster-name-text">{s.full_name}</div>
                        <div className="roster-roll-text">{s.roll_number || 'Enrolled'}</div>
                      </div>
                    </div>

                    <div>
                      {isPresent ? (
                        <span className="badge badge-present">✓ Present</span>
                      ) : (
                        <button
                          onClick={() => handleManualOverride(s.student_id)}
                          disabled={overrideLoading === s.student_id}
                          className="btn btn-primary btn-sm"
                          type="button"
                        >
                          {overrideLoading === s.student_id ? '...' : 'Mark Present'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {filteredRoster.length === 0 && (
                <p className="text-dim text-sm text-center py-6">
                  {activeSession ? 'No matching students' : 'No active session. Launch session to view roster.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: PAST SESSIONS */}
        {activeTab === 'history' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="card-header">
              <h2>Past Sessions</h2>
              <span className="badge badge-closed">{sessions.length} Recorded</span>
            </div>

            <div className="table-wrapper" style={{ flex: 1 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Period</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="font-mono">{s.session_date}</td>
                      <td>Period {s.period}</td>
                      <td>
                        <span className={`badge ${s.status === 'active' ? 'badge-present' : 'badge-closed'}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center text-dim">
                        No sessions recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Mobile Tab Bar */}
      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'broadcast' ? 'active' : ''}`}
          onClick={() => setActiveTab('broadcast')}
        >
          <span className="mobile-nav-icon">📡</span>
          <span>Broadcast</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'roster' ? 'active' : ''}`}
          onClick={() => setActiveTab('roster')}
        >
          <span className="mobile-nav-icon">📋</span>
          <span>Roster</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span className="mobile-nav-icon">🕒</span>
          <span>History</span>
        </button>
      </nav>
    </div>
  );
}
