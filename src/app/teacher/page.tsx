'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

  const [activeTab, setActiveTab] = useState<'console' | 'rollcall' | 'history'>('console');
  const [rosterFilter, setRosterFilter] = useState<'all' | 'unmarked' | 'present'>('all');
  const [selectedStudentForModal, setSelectedStudentForModal] = useState<StudentRosterItem | null>(null);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  function toggleDate(dateKey: string) {
    setExpandedDates((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  }

  // Group sessions by date
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, AttendanceSession[]>();
    for (const s of sessions) {
      const d = s.session_date || 'Undated';
      const list = map.get(d) || [];
      list.push(s);
      map.set(d, list);
    }
    return Array.from(map.entries()).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [sessions]);

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

  const filteredRoster = roster.filter((s) => {
    const matchesSearch =
      s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.roll_number.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (rosterFilter === 'present') return s.attendance_status === 'present';
    if (rosterFilter === 'unmarked') return s.attendance_status !== 'present';
    return true;
  });

  const presentCount = roster.filter((s) => s.attendance_status === 'present').length;
  const totalCount = roster.length;
  const unmarkedCount = Math.max(0, totalCount - presentCount);

  return (
    <div className="mobile-app-shell">
      {/* Top Mobile Header Bar */}
      <header className="mobile-app-header">
        <div className="brand-header-wrap">
          <h1>Faculty Console</h1>
          <span className="user-info">{profile?.full_name || 'Teacher'}</span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout} type="button">
          Sign Out
        </button>
      </header>

      {/* Main Tab Screen Content */}
      <main className={`mobile-app-content ${activeTab === 'console' ? 'fit-screen' : ''}`}>
        {/* Banner Alerts */}
        {error && <div className="alert alert-error">⚠️ {error}</div>}
        {success && <div className="alert alert-success">✅ {success}</div>}

        {/* FLOATING LIVE CODE PILL (Disappears when timeLeft <= 0 or session closed) */}
        {activeSession && timeLeft > 0 && (
          <div className="live-code-pill">
            <div className="pill-left">
              <span className="pulse-dot"></span>
              <span className="pill-tag">LIVE PIN</span>
              <span className="pill-code">{token || '••••'}</span>
            </div>
            <div className="pill-right">
              <span className="pill-timer">⏳ {timeLeft}s</span>
              <button
                type="button"
                className="pill-btn"
                onClick={() => {
                  if (activeTab !== 'console') setActiveTab('console');
                  setHudMode(hudMode === 'token' ? 'qr' : 'token');
                }}
                title="Toggle Mode"
              >
                {hudMode === 'token' ? 'QR Code' : 'PIN'}
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: SESSION CONSOLE (FIT SCREEN, ZERO SCROLL) */}
        {activeTab === 'console' && (
          activeSession ? (
            <div className="flex-col gap-1 justify-between" style={{ height: '100%' }}>
              <div className="card" style={{ marginBottom: '0.4rem' }}>
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
                    4-Digit PIN
                  </button>
                  <button
                    onClick={() => setHudMode('qr')}
                    className={`hud-tab-btn ${hudMode === 'qr' ? 'active' : ''}`}
                    type="button"
                  >
                    Dynamic QR Code
                  </button>
                </div>

                {/* Main Broadcast Hero Display */}
                {hudMode === 'token' ? (
                  <div className="token-display">
                    <div className="text-sm text-dim">Broadcast PIN to Class</div>
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
                    Rotate Code
                  </button>
                  <button
                    className="btn btn-danger btn-block"
                    onClick={closeSession}
                    type="button"
                  >
                    Close Session
                  </button>
                </div>
              </div>

              {/* Physical Roll Call Shift Card */}
              <div
                className="roll-call-shift-card"
                onClick={() => setActiveTab('rollcall')}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-1" style={{ minWidth: 0 }}>
                  <div className="shift-icon">📋</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="shift-title">Physical Roll Call & Override</div>
                    <div className="shift-subtitle">Shift to mark physical attendance</div>
                  </div>
                </div>
                <div className="shift-badge">
                  {presentCount}/{totalCount} Marked →
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <h2>Launch Attendance</h2>
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
                  {loading ? 'Initiating Session...' : 'Launch Attendance Session'}
                </button>
              </form>
            </div>
          )
        )}

        {/* TAB 2: ROLL CALL REGISTER & MANUAL OVERRIDE */}
        {activeTab === 'rollcall' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="card-header">
              <div>
                <h2>Roll Call Register</h2>
                <p className="card-meta">
                  {presentCount} / {totalCount} Students Present
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => activeSession && fetchRoster(activeSession.id)}
                  disabled={!activeSession}
                  type="button"
                  title="Refresh Roster"
                >
                  Refresh
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setActiveTab('console')}
                  type="button"
                >
                  Console
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="roster-filter-bar">
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === 'all' ? 'active' : ''}`}
                onClick={() => setRosterFilter('all')}
              >
                All ({totalCount})
              </button>
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === 'unmarked' ? 'active' : ''}`}
                onClick={() => setRosterFilter('unmarked')}
              >
                Unmarked ({unmarkedCount})
              </button>
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === 'present' ? 'active' : ''}`}
                onClick={() => setRosterFilter('present')}
              >
                Present ({presentCount})
              </button>
            </div>

            {/* Search Box */}
            <div className="roster-search-box">
              <input
                type="text"
                placeholder="Search student by name or roll..."
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Scrollable Student Register List */}
            <div className="roster-list" style={{ flex: 1, maxHeight: 'none', overflowY: 'auto' }}>
              {filteredRoster.map((s) => {
                const isPresent = s.attendance_status === 'present';
                return (
                  <div key={s.student_id} className="roster-row">
                    <div
                      className="roster-student-meta"
                      style={{ cursor: 'pointer', flex: 1 }}
                      onClick={() => setSelectedStudentForModal(s)}
                      title="Click to view student details"
                    >
                      {s.photo_url ? (
                        <Image
                          src={s.photo_url}
                          alt={s.full_name}
                          width={34}
                          height={34}
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
                        <div className="roster-roll-text">{s.roll_number || 'Enrolled'} • View Info</div>
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
                  {activeSession ? 'No matching students found.' : 'No active session. Launch session to start roll call.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: DATE-GROUPED SESSION HISTORY */}
        {activeTab === 'history' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="card-header">
              <div>
                <h2>Session History</h2>
                <p className="card-meta">Grouped by Date • {sessions.length} total sessions</p>
              </div>
              <span className="badge badge-closed">{sessionsByDate.length} Days</span>
            </div>

            <div className="date-group-list" style={{ flex: 1, overflowY: 'auto', paddingRight: '2px' }}>
              {sessionsByDate.map(([dateKey, daySessions]) => {
                const isExpanded = expandedDates[dateKey] ?? true; // expanded by default
                return (
                  <div key={dateKey} className="date-group-card">
                    <div
                      className="date-group-header"
                      onClick={() => toggleDate(dateKey)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="date-group-title">
                        <span>{dateKey}</span>
                        <span className="text-dim text-xs">({daySessions.length} {daySessions.length === 1 ? 'class' : 'classes'})</span>
                      </div>
                      <span className="date-group-badge">
                        {isExpanded ? 'Hide ▲' : 'Show ▼'}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="date-group-content">
                        {daySessions.map((s) => (
                          <div key={s.id} className="date-session-item">
                            <div className="date-session-meta">
                              <div className="date-session-title">
                                Period {s.period}
                              </div>
                              <div className="date-session-sub">
                                Session ID: {s.id.slice(0, 8)}...
                              </div>
                            </div>
                            <span className={`badge ${s.status === 'active' ? 'badge-present' : 'badge-closed'}`}>
                              {s.status === 'active' ? 'LIVE' : 'COMPLETED'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {sessionsByDate.length === 0 && (
                <p className="text-center text-dim py-8 text-sm">
                  No session history recorded yet.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* STUDENT DETAILS MODAL */}
      {selectedStudentForModal && (
        <div className="modal-backdrop" onClick={() => setSelectedStudentForModal(null)}>
          <div className="student-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <h3>Student Profile</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedStudentForModal(null)}
              >
                ✕
              </button>
            </div>

            <div className="student-modal-body">
              <div className="student-modal-avatar-wrap">
                {selectedStudentForModal.photo_url ? (
                  <Image
                    src={selectedStudentForModal.photo_url}
                    alt={selectedStudentForModal.full_name}
                    width={96}
                    height={96}
                    className="student-modal-avatar"
                    unoptimized
                  />
                ) : (
                  <div className="student-modal-avatar-fallback">
                    {selectedStudentForModal.full_name.charAt(0) || 'S'}
                  </div>
                )}
              </div>

              <h2 className="student-modal-name">{selectedStudentForModal.full_name}</h2>
              <p className="student-modal-roll">{selectedStudentForModal.roll_number || 'Enrolled Student'}</p>

              <div className="student-modal-info-grid">
                <div className="info-cell">
                  <span className="info-label">Email</span>
                  <span className="info-val">{selectedStudentForModal.email || 'N/A'}</span>
                </div>
                <div className="info-cell">
                  <span className="info-label">Department</span>
                  <span className="info-val">{selectedDepartment}</span>
                </div>
                <div className="info-cell">
                  <span className="info-label">Academic Year</span>
                  <span className="info-val">Year {selectedYear}</span>
                </div>
                <div className="info-cell">
                  <span className="info-label">Status</span>
                  <span className="info-val">
                    <span className={`badge ${selectedStudentForModal.attendance_status === 'present' ? 'badge-present' : 'badge-absent'}`}>
                      {selectedStudentForModal.attendance_status === 'present' ? 'Present' : 'Absent'}
                    </span>
                  </span>
                </div>
              </div>

              {selectedStudentForModal.attendance_status !== 'present' && activeSession && (
                <button
                  type="button"
                  className="btn btn-primary btn-block mt-1"
                  disabled={overrideLoading === selectedStudentForModal.student_id}
                  onClick={() => {
                    handleManualOverride(selectedStudentForModal.student_id);
                    setSelectedStudentForModal((prev) =>
                      prev ? { ...prev, attendance_status: 'present' } : null
                    );
                  }}
                >
                  {overrideLoading === selectedStudentForModal.student_id
                    ? 'Recording...'
                    : 'Mark Present (Manual Override)'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Mobile Tab Bar (Clean Text-Only Navigation) */}
      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'console' ? 'active' : ''}`}
          onClick={() => setActiveTab('console')}
        >
          <span>Console</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'rollcall' ? 'active' : ''}`}
          onClick={() => setActiveTab('rollcall')}
        >
          <span>Roll Call</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span>History</span>
        </button>
      </nav>
    </div>
  );
}


