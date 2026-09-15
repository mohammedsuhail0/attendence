'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import Image from 'next/image';

interface AttendanceRecord {
  student_id: string;
  status: string;
  mark_mode?: string;
  marked_at?: string;
  profiles: {
    full_name: string;
    roll_number: string;
  };
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

interface ClassItem {
  id: string;
  subject: string;
  department: string;
  section: string;
  year: number;
}

interface ActiveSession {
  id: string;
  class_id: string;
  token: string;
  token_expires_at: string;
  period: number;
  session_date: string;
  status: string;
  classes?: ClassItem;
}

interface SessionSummaryItem {
  id: string;
  class_id: string;
  session_date: string;
  period: number;
  status: string;
  created_at: string;
  classes?: ClassItem;
  attendance_summary?: {
    total: number;
    present: number;
    absent: number;
    biometric: number;
    manual_override: number;
    auto_absent: number;
  };
}

export default function TeacherDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [period, setPeriod] = useState(1);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [activeTab, setActiveTab] = useState<'hud' | 'archive'>('hud');
  const [broadcastMode, setBroadcastMode] = useState<'token' | 'qr'>('qr');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  const [roster, setRoster] = useState<StudentRosterItem[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [pastSessions, setPastSessions] = useState<SessionSummaryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [timeLeft, setTimeLeft] = useState(25);
  const [loading, setLoading] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);

  const activeSessionRef = useRef<ActiveSession | null>(null);
  activeSessionRef.current = activeSession;

  // Generate QR Code data URL whenever token changes
  const generateQR = useCallback(async (token: string) => {
    if (!token) return;
    try {
      const studentUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/student?token=${encodeURIComponent(token)}`
        : `https://smart-attendance.edu/student?token=${token}`;
      
      const url = await QRCode.toDataURL(studentUrl, {
        width: 380,
        margin: 1.5,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H',
      });
      setQrCodeDataUrl(url);
    } catch (err) {
      console.error('Failed to generate QR code', err);
    }
  }, []);

  // Fetch classes
  const fetchClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/classes');
      const data = await res.json();
      if (res.ok && data.classes) {
        setClasses(data.classes);
        if (data.classes.length > 0 && !selectedClass) {
          setSelectedClass(data.classes[0].id);
        }
      }
    } catch (e) {
      console.error('Error fetching classes:', e);
    }
  }, [selectedClass]);

  // Fetch sessions list & detect active session
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (res.ok && data.sessions) {
        setPastSessions(data.sessions);
        const active = data.sessions.find((s: SessionSummaryItem) => s.status === 'active');
        if (active) {
          setActiveSession(active);
          generateQR(active.token);
        }
      }
    } catch (e) {
      console.error('Error fetching sessions:', e);
    }
  }, [generateQR]);

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

  const fetchRecords = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/attendance`);
      const data = await res.json();
      if (res.ok && data.records) {
        setRecords(data.records);
      }
    } catch (e) {
      console.error('Error fetching records:', e);
    }
  }, []);

  // Check auth & initial load
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      await fetchClasses();
      await fetchSessions();
    }
    init();
  }, [supabase, router, fetchClasses, fetchSessions]);

  // Handle active session data sync
  useEffect(() => {
    if (!activeSession) return;

    fetchRoster(activeSession.id);
    fetchRecords(activeSession.id);

    // Refresh roster & records every 4 seconds
    const interval = setInterval(() => {
      if (activeSessionRef.current) {
        fetchRoster(activeSessionRef.current.id);
        fetchRecords(activeSessionRef.current.id);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeSession, fetchRoster, fetchRecords]);

  // Refresh token API call
  const refreshToken = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.token) {
        setActiveSession((prev) => prev ? { ...prev, token: data.token, token_expires_at: data.token_expires_at } : null);
        generateQR(data.token);
        setTimeLeft(25);
      }
    } catch (e) {
      console.error('Error rotating token:', e);
    }
  }, [generateQR]);

  // Auto-refresh token rotation countdown (25 seconds)
  useEffect(() => {
    if (!activeSession) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Trigger token refresh
          refreshToken(activeSession.id);
          return 25;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeSession, refreshToken]);

  // Start new attendance session
  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) {
      setError('Please select a subject class');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_id: selectedClass,
          period: Number(period),
          session_date: today,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start session');

      setActiveSession(data.session);
      generateQR(data.session.token);
      setTimeLeft(25);
      setSuccess('Session started! Broadcasting live.');
      await fetchSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error starting session');
    } finally {
      setLoading(false);
    }
  };

  // Close attendance session
  const handleCloseSession = async () => {
    if (!activeSession) return;
    if (!confirm('Are you sure you want to close this attendance session? Absent students will be auto-marked.')) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/close`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to close session');

      setActiveSession(null);
      setSuccess('Session closed and attendance locked successfully.');
      await fetchSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error closing session');
    } finally {
      setLoading(false);
    }
  };

  // Manual Override: 1-Tap mark present
  const handleManualOverride = async (studentId: string) => {
    if (!activeSession) return;
    setOverrideLoading(studentId);
    try {
      // Optimistic update
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
      await fetchRecords(activeSession.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Override failed');
      await fetchRoster(activeSession.id);
    } finally {
      setOverrideLoading(null);
    }
  };

  // Copy token to clipboard
  const handleCopyToken = () => {
    if (!activeSession?.token) return;
    navigator.clipboard.writeText(activeSession.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!roster.length) return;
    const headers = ['Roll Number', 'Full Name', 'Email', 'Status'];
    const rows = roster.map((s) => [
      s.roll_number,
      `"${s.full_name}"`,
      s.email,
      s.attendance_status === 'present' ? 'Present' : 'Absent',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Attendance_Session_${activeSession?.session_date || 'report'}_P${activeSession?.period || 1}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter roster
  const filteredRoster = roster.filter(
    (s) =>
      s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.roll_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const presentCount = roster.filter((s) => s.attendance_status === 'present').length;
  const totalCount = roster.length;
  const attendanceRate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
  const defaulterWarningCount = roster.filter((s) => s.attendance_status !== 'present').length;

  const currentClassInfo = classes.find((c) => c.id === (activeSession?.class_id || selectedClass));

  return (
    <div className="viewport-app">
      {/* Top Header Bar */}
      <header className="viewport-header">
        <div className="header-brand">
          <div className="brand-badge">
            <span className="badge-dot pulse-emerald"></span>
            NOVA CLASS STUDIO
          </div>
          <div className="header-title-group">
            <h1>Teacher Attendance Studio</h1>
            <span className="text-secondary text-xs">
              {currentClassInfo
                ? `${currentClassInfo.subject} • Sec ${currentClassInfo.section} (Year ${currentClassInfo.year})`
                : 'Live Classroom Command Hub'}
            </span>
          </div>
        </div>

        <div className="header-actions">
          {activeSession ? (
            <div className="session-status-pill active">
              <span className="live-indicator"></span>
              <span className="font-semibold text-xs text-emerald-800">
                PERIOD {activeSession.period} LIVE
              </span>
              <span className="text-slate-400 text-xs">|</span>
              <span className="text-xs text-slate-600 font-mono">
                Auto-rotates in {timeLeft}s
              </span>
            </div>
          ) : (
            <div className="session-status-pill idle">
              <span className="text-xs text-slate-500 font-medium">Ready to Broadcast</span>
            </div>
          )}

          <div className="header-divider"></div>

          <button
            onClick={() => setActiveTab(activeTab === 'hud' ? 'archive' : 'hud')}
            className={`btn-header ${activeTab === 'archive' ? 'btn-header-active' : ''}`}
          >
            {activeTab === 'hud' ? '📋 Past Sessions' : '📡 Live Studio'}
          </button>

          <button onClick={handleSignOut} className="btn-header btn-header-danger">
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Viewport Content */}
      <div className="viewport-content">
        {/* Banner Alerts */}
        {error && (
          <div className="alert-banner alert-banner-error">
            <span>⚠️ {error}</span>
            <button onClick={() => setError('')} className="alert-close">×</button>
          </div>
        )}
        {success && (
          <div className="alert-banner alert-banner-success">
            <span>✅ {success}</span>
            <button onClick={() => setSuccess('')} className="alert-close">×</button>
          </div>
        )}

        {activeTab === 'hud' ? (
          <div className="viewport-grid grid-3col">
            {/* COLUMN 1: Session Controls & Parameters */}
            <section className="bento-card col-controls">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Session Controls</h2>
                  <p className="card-subtitle">Select class & launch broadcast</p>
                </div>
                <span className="badge-light">Period {period}</span>
              </div>

              {!activeSession ? (
                <form onSubmit={handleStartSession} className="control-form">
                  <div className="form-group">
                    <label className="form-label">Subject & Section</label>
                    <select
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="form-select"
                      required
                    >
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.subject} ({cls.department} - Sec {cls.section})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label className="form-label">Period</label>
                      <select
                        value={period}
                        onChange={(e) => setPeriod(Number(e.target.value))}
                        className="form-select"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                          <option key={p} value={p}>
                            Period {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group flex-1">
                      <label className="form-label">Date</label>
                      <input
                        type="text"
                        value={new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        disabled
                        className="form-input bg-slate-50 text-slate-500 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div className="security-notice-box">
                    <div className="security-notice-header">
                      <span>🛡️ Biometric WebAuthn Protected</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Students verify with fingerprint/FaceID passkey + dynamic anti-spoof rotating QR.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || classes.length === 0}
                    className="btn-primary w-full py-3 text-sm font-semibold shadow-sm"
                  >
                    {loading ? 'Launching Broadcast...' : '⚡ Start Live Attendance'}
                  </button>
                </form>
              ) : (
                <div className="active-session-summary">
                  <div className="active-session-badge">
                    <div className="pulse-indicator"></div>
                    <div>
                      <div className="text-xs font-semibold text-emerald-900 uppercase tracking-wider">
                        Session in Progress
                      </div>
                      <div className="text-sm font-bold text-slate-800">
                        {currentClassInfo?.subject || 'Class'} • Period {activeSession.period}
                      </div>
                    </div>
                  </div>

                  {/* Countdown Timer Card */}
                  <div className="timer-card">
                    <div className="timer-header">
                      <span className="text-xs font-medium text-slate-600">Token Auto-Refresh</span>
                      <span className="font-mono text-sm font-bold text-indigo-600">{timeLeft}s</span>
                    </div>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${(timeLeft / 25) * 100}%` }}
                      ></div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Token refreshes every 25 seconds to prevent sharing.
                    </p>
                  </div>

                  {/* Manual Refresh & End Actions */}
                  <div className="session-actions-stack">
                    <button
                      onClick={() => refreshToken(activeSession.id)}
                      className="btn-secondary w-full text-xs font-semibold"
                    >
                      🔄 Rotate Token Now
                    </button>
                    <button
                      onClick={handleCloseSession}
                      disabled={loading}
                      className="btn-danger w-full text-xs font-semibold"
                    >
                      🛑 End Session & Lock
                    </button>
                  </div>
                </div>
              )}

              {/* Today's Quick Session List */}
              <div className="quick-archive-section">
                <div className="section-label">Today&apos;s Sessions</div>
                <div className="quick-archive-list">
                  {pastSessions.slice(0, 4).map((s) => (
                    <div key={s.id} className="quick-archive-row">
                      <div className="quick-archive-info">
                        <span className="font-medium text-slate-700">Period {s.period}</span>
                        <span className="text-xs text-slate-400">
                          {s.classes?.subject || 'Class'}
                        </span>
                      </div>
                      <span className={`status-badge-sm ${s.status === 'active' ? 'badge-active' : 'badge-closed'}`}>
                        {s.status}
                      </span>
                    </div>
                  ))}
                  {pastSessions.length === 0 && (
                    <p className="text-xs text-slate-400 py-2 text-center">No sessions recorded today</p>
                  )}
                </div>
              </div>
            </section>

            {/* COLUMN 2: Live Broadcast HUD (Centerpiece) */}
            <section className="bento-card col-broadcast">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Live Broadcast Display</h2>
                  <p className="card-subtitle">Display on classroom projector or front screen</p>
                </div>

                {/* Mode Switcher Pill */}
                <div className="mode-toggle-pill">
                  <button
                    onClick={() => setBroadcastMode('qr')}
                    className={`toggle-tab ${broadcastMode === 'qr' ? 'active' : ''}`}
                  >
                    📱 QR Code
                  </button>
                  <button
                    onClick={() => setBroadcastMode('token')}
                    className={`toggle-tab ${broadcastMode === 'token' ? 'active' : ''}`}
                  >
                    🔢 4-Digit PIN
                  </button>
                </div>
              </div>

              {activeSession ? (
                <div className="broadcast-hero">
                  {broadcastMode === 'qr' ? (
                    <div className="qr-broadcast-container">
                      <div className="qr-box-elevated">
                        {qrCodeDataUrl ? (
                          <Image
                            src={qrCodeDataUrl}
                            alt="Attendance QR Code"
                            width={280}
                            height={280}
                            className="qr-image"
                            priority
                            unoptimized
                          />
                        ) : (
                          <div className="qr-placeholder">Generating live QR...</div>
                        )}
                      </div>
                      <div className="qr-caption">
                        <span className="badge-qr-pulse">
                          <span className="pulse-dot"></span> LIVE DYNAMIC QR
                        </span>
                        <p className="qr-instruction">
                          Scan with camera or mobile browser to verify attendance
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="token-broadcast-container">
                      <div className="token-display-box">
                        <div className="token-digits">
                          {activeSession.token.split('').map((char, index) => (
                            <span key={index} className="token-digit-cell">
                              {char}
                            </span>
                          ))}
                        </div>
                        <button onClick={handleCopyToken} className="btn-copy-token">
                          {copied ? '✓ Copied' : '📋 Copy Token'}
                        </button>
                      </div>
                      <p className="token-instruction">
                        Students enter this 4-digit code in their portal with biometric verification
                      </p>
                    </div>
                  )}

                  {/* Live Attendance Stats Bar */}
                  <div className="live-stats-bar">
                    <div className="stat-item">
                      <span className="stat-label">Enrolled</span>
                      <span className="stat-value text-slate-800">{totalCount}</span>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                      <span className="stat-label">Present</span>
                      <span className="stat-value text-emerald-600">{presentCount}</span>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                      <span className="stat-label">Rate</span>
                      <span className="stat-value text-indigo-600">{attendanceRate}%</span>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="stat-item">
                      <span className="stat-label">Unmarked</span>
                      <span className="stat-value text-amber-600">{defaulterWarningCount}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="broadcast-idle-state">
                  <div className="idle-icon-wrap">
                    <span className="text-4xl">📡</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-700">Studio is Standby</h3>
                  <p className="text-xs text-slate-400 max-w-xs text-center mt-1">
                    Select a class and click <strong>Start Live Attendance</strong> on the left panel to broadcast the dynamic QR code or 4-digit token.
                  </p>
                </div>
              )}
            </section>

            {/* COLUMN 3: Live Attendance Roster & Manual Override */}
            <section className="bento-card col-roster">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Live Roster</h2>
                  <p className="card-subtitle">Real-time check-in & manual override</p>
                </div>
                {activeSession && (
                  <button onClick={handleExportCSV} className="btn-export-sm" title="Export CSV">
                    📥 CSV
                  </button>
                )}
              </div>

              {/* Roster Search Filter */}
              <div className="roster-search-bar">
                <input
                  type="text"
                  placeholder="Search student or roll no..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="roster-search-input"
                />
              </div>

              {/* Student Rows Container (Internal Scroll) */}
              <div className="roster-list-container">
                {filteredRoster.map((student) => {
                  const isPresent = student.attendance_status === 'present';
                  return (
                    <div
                      key={student.student_id}
                      className={`student-roster-row ${isPresent ? 'row-present' : 'row-absent'}`}
                    >
                      <div className="student-avatar-wrap">
                        {student.photo_url ? (
                          <Image
                            src={student.photo_url}
                            alt={student.full_name}
                            width={34}
                            height={34}
                            className="student-avatar-img"
                            unoptimized
                          />
                        ) : (
                          <div className="student-avatar-fallback">
                            {student.full_name.charAt(0) || 'S'}
                          </div>
                        )}
                      </div>

                      <div className="student-meta">
                        <div className="student-name">{student.full_name}</div>
                        <div className="student-roll">{student.roll_number || 'No Roll'}</div>
                      </div>

                      <div className="student-action">
                        {isPresent ? (
                          <span className="badge-present">
                            ✓ Present
                          </span>
                        ) : (
                          <button
                            onClick={() => handleManualOverride(student.student_id)}
                            disabled={!activeSession || overrideLoading === student.student_id}
                            className="btn-mark-override"
                            title="1-Tap Manual Override"
                          >
                            {overrideLoading === student.student_id ? '...' : '+ Mark'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredRoster.length === 0 && (
                  <div className="roster-empty-state">
                    <p className="text-xs text-slate-400">
                      {activeSession ? 'No matching students found' : 'Start a session to view student roster'}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          /* PAST SESSIONS ARCHIVE VIEW */
          <div className="archive-view-container">
            <div className="bento-card archive-card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Attendance Session History</h2>
                  <p className="card-subtitle">Full historical logs and exports</p>
                </div>
                <span className="badge-light">{pastSessions.length} Total Sessions</span>
              </div>

              <div className="archive-table-container">
                <table className="archive-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Subject & Section</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Present / Total</th>
                      <th>Attendance Rate</th>
                      <th>Method Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastSessions.map((session) => {
                      const summary = session.attendance_summary || {
                        total: 0,
                        present: 0,
                        absent: 0,
                        biometric: 0,
                        manual_override: 0,
                        auto_absent: 0,
                      };
                      const rate = summary.total > 0 ? Math.round((summary.present / summary.total) * 100) : 0;

                      return (
                        <tr key={session.id}>
                          <td className="font-mono text-xs">{session.session_date}</td>
                          <td className="font-semibold text-slate-800">
                            {session.classes?.subject || 'Class'} ({session.classes?.department} - Sec {session.classes?.section})
                          </td>
                          <td>Period {session.period}</td>
                          <td>
                            <span className={`status-badge-sm ${session.status === 'active' ? 'badge-active' : 'badge-closed'}`}>
                              {session.status}
                            </span>
                          </td>
                          <td className="font-semibold">
                            {summary.present} / {summary.total}
                          </td>
                          <td>
                            <span className={`font-bold ${rate >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {rate}%
                            </span>
                          </td>
                          <td className="text-xs text-slate-500">
                            🔐 {summary.biometric} Bio • ✍️ {summary.manual_override} Manual
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
