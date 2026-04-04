'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { Class, AttendanceSession } from '@/types/database';
import { formatDisplayDate, getDateStringInTimeZone } from '@/lib/utils';

const DEPARTMENT_OPTIONS = ['IT', 'CSE', 'AIDS', 'Civil', 'Mech'] as const;
const YEAR_OPTIONS = ['1', '2', '3', '4'] as const;

function getClassYear(cls: Class) {
  // Keep old demo data working while section values are moved from A/B labels to year numbers.
  return cls.section === 'A' ? '1' : cls.section;
}

type ManualOverrideStudent = {
  student_id: string;
  full_name: string;
  roll_number: string;
  photo_url?: string | null;
  photo_path?: string | null;
  attendance_status: 'present' | 'absent' | 'not_marked';
};

type HistoryPresentStudent = {
  student_id: string;
  full_name: string;
  roll_number: string;
  mode: 'biometric' | 'manual_override' | 'unknown';
};

function monthLabel(monthValue: string): string {
  const [year, month] = monthValue.split('-');
  const monthIndex = Number(month) - 1;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return monthValue;
  return `${monthNames[monthIndex]} ${year}`;
}

export default function TeacherDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [classes, setClasses] = useState<Class[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [profile, setProfile] = useState<{ full_name: string } | null>(null);
  const [today, setToday] = useState(() => getDateStringInTimeZone());

  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [period, setPeriod] = useState(1);

  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [token, setToken] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [attendanceList, setAttendanceList] = useState<
    { status: string; profiles: { full_name: string; roll_number: string } }[]
  >([]);
  const [manualStudents, setManualStudents] = useState<ManualOverrideStudent[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSubmittingId, setManualSubmittingId] = useState('');
  const [manualQuery, setManualQuery] = useState('');
  const [manualImageFallbacks, setManualImageFallbacks] = useState<Record<string, boolean>>({});
  const [historyMonthFilter, setHistoryMonthFilter] = useState('all');
  const [historyDateFilter, setHistoryDateFilter] = useState('all');
  const [historyPresentBySession, setHistoryPresentBySession] = useState<Record<string, HistoryPresentStudent[]>>({});
  const [historyPresentLoadingBySession, setHistoryPresentLoadingBySession] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const closeInFlightRef = useRef(false);
  const unloadCloseSentRef = useRef(false);

  useEffect(() => {
    const syncToday = () => {
      setToday(getDateStringInTimeZone());
    };

    syncToday();
    const interval = setInterval(syncToday, 60_000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
      if (d2.sessions) {
        const allSessions = d2.sessions as AttendanceSession[];
        const activeSessions = allSessions.filter((session) => session.status === 'active');

        // Clean up stale backend state so teachers do not see lingering active sessions.
        if (activeSessions.length > 0) {
          await Promise.all(
            activeSessions.map((session) =>
              fetch(`/api/sessions/${session.id}/close`, { method: 'POST' })
            )
          );

          const refreshed = await fetch('/api/sessions');
          const refreshedData = await refreshed.json();
          if (refreshedData.sessions) {
            setSessions(refreshedData.sessions);
          }
          setSuccess(`${activeSessions.length} active session${activeSessions.length > 1 ? 's were' : ' was'} auto-closed.`);
          return;
        }

        setSessions(allSessions);
      }
    }

    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const sendCloseOnExit = useCallback((sessionId: string) => {
    if (!sessionId || unloadCloseSentRef.current) return;
    unloadCloseSentRef.current = true;

    const closeUrl = `/api/sessions/${sessionId}/close`;

    // Keepalive fetch is preferred because it keeps auth cookies and follows same API behavior.
    try {
      void fetch(closeUrl, {
        method: 'POST',
        keepalive: true,
      });
    } catch {
      // no-op
    }

    // Fallback for browsers where keepalive fetch may be unreliable during unload.
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(closeUrl);
      }
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed') {
      unloadCloseSentRef.current = false;
      return;
    }

    const sessionId = activeSession.id;
    const handleBeforeUnload = () => {
      sendCloseOnExit(sessionId);
    };

    const handlePageHide = () => {
      sendCloseOnExit(sessionId);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [activeSession, sendCloseOnExit]);

  const departments = [...DEPARTMENT_OPTIONS];
  const years = [...YEAR_OPTIONS];
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

  const historyMonthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const session of sessions) {
      const date = session.session_date;
      if (date && date.length >= 7) months.add(date.slice(0, 7));
    }
    return Array.from(months).sort((left, right) => right.localeCompare(left));
  }, [sessions]);

  const historyDateOptions = useMemo(() => {
    const dates = new Set<string>();
    for (const session of sessions) {
      const date = session.session_date;
      if (!date) continue;
      if (historyMonthFilter !== 'all' && !date.startsWith(historyMonthFilter)) continue;
      dates.add(date);
    }
    return Array.from(dates).sort((left, right) => right.localeCompare(left));
  }, [sessions, historyMonthFilter]);

  useEffect(() => {
    setHistoryDateFilter('all');
  }, [historyMonthFilter]);

  const filteredHistorySessions = useMemo(() => {
    return sessions
      .filter((session) => {
        if (session.status !== 'closed') return false;
        const date = session.session_date || '';
        if (historyMonthFilter !== 'all' && !date.startsWith(historyMonthFilter)) return false;
        if (historyDateFilter !== 'all' && date !== historyDateFilter) return false;
        return true;
      })
      .sort((left, right) => {
        const dateCompare = right.session_date.localeCompare(left.session_date);
        if (dateCompare !== 0) return dateCompare;
        return left.period - right.period;
      });
  }, [sessions, historyMonthFilter, historyDateFilter]);

  const groupedHistorySessions = useMemo(() => {
    const groups = new Map<string, AttendanceSession[]>();
    for (const session of filteredHistorySessions) {
      const date = session.session_date || 'unknown';
      const existing = groups.get(date) || [];
      existing.push(session);
      groups.set(date, existing);
    }
    return Array.from(groups.entries()).sort((left, right) => right[0].localeCompare(left[0]));
  }, [filteredHistorySessions]);

  const loadHistoryPresentStudents = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    if (historyPresentLoadingBySession[sessionId]) return;

    setHistoryPresentLoadingBySession((prev) => ({
      ...prev,
      [sessionId]: true,
    }));

    const res = await fetch(`/api/sessions/${sessionId}/attendance`);
    const data = await res.json();

    if (!res.ok) {
      setHistoryPresentLoadingBySession((prev) => ({
        ...prev,
        [sessionId]: false,
      }));
      return;
    }

    const presentStudents: HistoryPresentStudent[] = (data.records || [])
      .filter((record: { status?: string }) => record.status === 'present')
      .map(
        (record: {
          student_id: string;
          mark_mode?: string | null;
          marked_by?: string | null;
          profiles?: { full_name?: string | null; roll_number?: string | null };
        }) => ({
          student_id: record.student_id,
          full_name: record.profiles?.full_name || 'Unknown Student',
          roll_number: record.profiles?.roll_number || '-',
          mode:
            record.mark_mode === 'manual_override'
              ? 'manual_override'
              : record.mark_mode === 'biometric'
                ? 'biometric'
                : record.marked_by && record.marked_by !== record.student_id
                  ? 'manual_override'
                  : 'unknown',
        })
      )
      .sort((left: HistoryPresentStudent, right: HistoryPresentStudent) => {
        const leftRoll = String(left.roll_number || '').trim();
        const rightRoll = String(right.roll_number || '').trim();
        if (leftRoll && rightRoll) return leftRoll.localeCompare(rightRoll, undefined, { numeric: true });
        return left.full_name.localeCompare(right.full_name);
      });

    setHistoryPresentBySession((prev) => ({
      ...prev,
      [sessionId]: presentStudents,
    }));

    setHistoryPresentLoadingBySession((prev) => ({
      ...prev,
      [sessionId]: false,
    }));
  }, [historyPresentLoadingBySession]);

  useEffect(() => {
    for (const session of filteredHistorySessions) {
      if ((session.attendance_summary?.present ?? 0) === 0) {
        if (!Object.prototype.hasOwnProperty.call(historyPresentBySession, session.id)) {
          setHistoryPresentBySession((prev) => ({
            ...prev,
            [session.id]: [],
          }));
        }
        continue;
      }

      const alreadyLoaded = Object.prototype.hasOwnProperty.call(historyPresentBySession, session.id);
      if (alreadyLoaded || historyPresentLoadingBySession[session.id]) continue;
      void loadHistoryPresentStudents(session.id);
    }
  }, [filteredHistorySessions, historyPresentBySession, historyPresentLoadingBySession, loadHistoryPresentStudents]);

  const loadAttendanceList = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/attendance`);
    const data = await res.json();
    if (data.records) setAttendanceList(data.records);
  }, []);

  const loadManualOverrideStudents = useCallback(async (sessionId: string) => {
    setManualLoading(true);
    const res = await fetch(`/api/sessions/${sessionId}/manual-override`);
    const data = await res.json();
    if (!res.ok) {
      setManualLoading(false);
      setError(data.error || 'Failed to load manual override list');
      return;
    }
    setManualStudents((data.students || []) as ManualOverrideStudent[]);
    setManualLoading(false);
  }, []);

  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed') return;

    const poll = async () => {
      await loadAttendanceList(activeSession.id);
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [activeSession, loadAttendanceList]);

  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed') {
      setManualStudents([]);
      return;
    }

    loadManualOverrideStudents(activeSession.id);
  }, [activeSession, loadManualOverrideStudents]);

  async function markManualPresent(studentId: string) {
    if (!activeSession) return;
    setError('');
    setSuccess('');
    setManualSubmittingId(studentId);

    const res = await fetch(`/api/sessions/${activeSession.id}/manual-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId }),
    });
    const data = await res.json();

    if (!res.ok) {
      setManualSubmittingId('');
      setError(data.error || 'Failed to mark attendance via manual override');
      return;
    }

    setSuccess('Manual override marked successfully.');
    await loadManualOverrideStudents(activeSession.id);
    await loadAttendanceList(activeSession.id);
    setManualSubmittingId('');
  }

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

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        class_id: selectedClass.id,
        period,
        session_date: today,
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

  const closeSession = useCallback(async () => {
    if (!activeSession || closeInFlightRef.current) return;
    closeInFlightRef.current = true;

    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/close`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to close session');
        return;
      }

      setActiveSession(null);
      setToken('');
      setTimeLeft(0);
      setManualStudents([]);
      setManualQuery('');
      setSuccess(`Session closed. Present: ${data.present}, Absent: ${data.absent}`);

      const res2 = await fetch('/api/sessions');
      const d2 = await res2.json();
      if (d2.sessions) setSessions(d2.sessions);
      unloadCloseSentRef.current = false;
    } finally {
      closeInFlightRef.current = false;
    }
  }, [activeSession]);

  const filteredManualStudents = manualStudents.filter((student) => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      student.full_name.toLowerCase().includes(q) ||
      String(student.roll_number || '').toLowerCase().includes(q)
    );
  });

  function getManualAvatar(student: ManualOverrideStudent): string {
    if (!manualImageFallbacks[student.student_id] && student.photo_url) {
      return student.photo_url;
    }

    if (!manualImageFallbacks[student.student_id] && student.photo_path) {
      return student.photo_path;
    }

    const seed = encodeURIComponent(student.roll_number || student.full_name || student.student_id);
    return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}`;
  }

  async function handleLogout() {
    if (activeSession && activeSession.status !== 'closed') {
      await closeSession();
    }
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="page teacher-app-shell">
      <div className="page-header teacher-app-header">
        <div className="teacher-title-wrap">
          <h1>Teacher Studio</h1>
          <span className="user-info">{profile?.full_name}</span>
        </div>
        <button className="btn btn-outline btn-sm teacher-logout-btn" onClick={handleLogout}>
          Sign Out
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {activeSession && (
        <div className="card teacher-live-card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-header teacher-card-header">
            <h2>Active Session</h2>
            <span className="badge badge-active">LIVE</span>
          </div>

          <div className="token-display teacher-token-display">
            <p className="text-dim text-sm">Share this token with students</p>
            <div className="token-code">{token}</div>
            <p className={`token-timer ${timeLeft > 0 ? 'active' : 'expired'}`}>
              {timeLeft > 0 ? `${timeLeft}s remaining` : 'Token expired'}
            </p>
          </div>

          <div className="flex-between mt-2 teacher-live-actions">
            <button className="btn btn-primary btn-sm" onClick={refreshToken}>
              New Token
            </button>
            <button className="btn btn-danger btn-sm" onClick={closeSession}>
              Close Session
            </button>
          </div>

          {attendanceList.length > 0 && (
            <div className="mt-3">
              <h3>
                Attendance (
                {attendanceList.filter((record) => record.status === 'present').length} present)
              </h3>
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
                    {attendanceList.map((record, index) => (
                      <tr key={index}>
                        <td>{record.profiles?.roll_number || '-'}</td>
                        <td>{record.profiles?.full_name || '-'}</td>
                        <td>
                          <span className={`badge badge-${record.status}`}>
                            {record.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="teacher-manual-card mt-3">
            <div className="teacher-manual-head">
              <h3>Manual Override</h3>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() => activeSession && loadManualOverrideStudents(activeSession.id)}
                disabled={manualLoading}
              >
                {manualLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            <div className="form-group mt-1">
              <label htmlFor="manual-search">Find student (name or roll no)</label>
              <input
                id="manual-search"
                type="text"
                className="form-input"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="Search by name or roll number"
              />
            </div>

            {filteredManualStudents.length === 0 ? (
              <p className="text-dim text-sm">No students found for manual override.</p>
            ) : (
              <div className="teacher-manual-list">
                {filteredManualStudents.map((student) => {
                  const alreadyPresent = student.attendance_status === 'present';
                  return (
                    <article className="teacher-manual-item" key={student.student_id}>
                      <img
                        src={getManualAvatar(student)}
                        alt={student.full_name}
                        className="teacher-manual-avatar"
                        onError={() =>
                          setManualImageFallbacks((prev) => ({
                            ...prev,
                            [student.student_id]: true,
                          }))
                        }
                      />
                      <div className="teacher-manual-meta">
                        <h4>{student.full_name}</h4>
                        <p>{student.roll_number || 'No roll number'}</p>
                      </div>
                      <span className={`badge badge-${alreadyPresent ? 'present' : 'closed'}`}>
                        {alreadyPresent ? 'present' : 'not marked'}
                      </span>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={alreadyPresent || manualSubmittingId === student.student_id}
                        onClick={() => markManualPresent(student.student_id)}
                      >
                        {manualSubmittingId === student.student_id ? 'Saving...' : alreadyPresent ? 'Marked' : 'Mark Present'}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!activeSession && (
        <div className="card teacher-create-card">
          <h2>Start New Session</h2>
          <form onSubmit={createSession} className="mt-2 teacher-session-form">
            <div className="form-group">
              <label htmlFor="department-select">Department</label>
              <select
                id="department-select"
                className="form-select"
                value={selectedDepartment}
                onChange={(e) => {
                  setSelectedDepartment(e.target.value);
                  setSelectedYear('');
                  setSelectedSubject('');
                }}
                required
              >
                <option value="">Select department...</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="year-select">Year</label>
                <select
                  id="year-select"
                  className="form-select"
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setSelectedSubject('');
                  }}
                  disabled={!selectedDepartment}
                  required
                >
                  <option value="">Select year...</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="subject-select">Subject</label>
                <select
                  id="subject-select"
                  className="form-select"
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  disabled={!selectedYear}
                  required
                >
                  <option value="">Select subject...</option>
                  {subjects.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
              </div>
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
                  {[1, 2, 3, 4, 5, 6].map((slot) => (
                    <option key={slot} value={slot}>
                      Period {slot}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="session-date">Date</label>
                <input
                  id="session-date"
                  type="date"
                  className="form-input"
                  value={today}
                  readOnly
                  aria-readonly="true"
                  required
                />
                <p className="text-dim text-sm mt-1">Locked to today.</p>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={
                loading ||
                !selectedDepartment ||
                !selectedYear ||
                !selectedSubject
              }
            >
              {loading ? 'Creating...' : 'Start Session & Generate Token'}
            </button>
          </form>
        </div>
      )}

      <div className="card mt-3 teacher-history-card">
        <h2>Session History</h2>
        {sessions.length === 0 ? (
          <p className="text-dim text-sm mt-1">No sessions yet</p>
        ) : (
          <>
            <div className="history-filters mt-1">
              <div className="history-filter-grid">
                <div className="form-group">
                  <label htmlFor="teacher-history-month">Month</label>
                  <select
                    id="teacher-history-month"
                    className="form-select"
                    value={historyMonthFilter}
                    onChange={(e) => setHistoryMonthFilter(e.target.value)}
                  >
                    <option value="all">All Months</option>
                    {historyMonthOptions.map((month) => (
                      <option key={month} value={month}>{monthLabel(month)}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="teacher-history-date">Date</label>
                  <select
                    id="teacher-history-date"
                    className="form-select"
                    value={historyDateFilter}
                    onChange={(e) => setHistoryDateFilter(e.target.value)}
                  >
                    <option value="all">All Dates</option>
                    {historyDateOptions.map((date) => (
                      <option key={date} value={date}>{formatDisplayDate(date)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {groupedHistorySessions.length === 0 ? (
              <p className="text-dim text-sm">No sessions found for selected filters.</p>
            ) : (
              <div className="history-date-groups">
                {groupedHistorySessions.map(([date, items], index) => (
                  <details className="history-date-group" key={date} open={index === 0}>
                    <summary className="history-date-summary">
                      <span>{formatDisplayDate(date)}</span>
                      <span className="history-date-count">{items.length} sessions</span>
                    </summary>
                    <div className="history-date-content">
                      {items.map((session) => (
                        <article className="history-entry" key={session.id}>
                          <div className="history-entry-top">
                            <h4>{session.classes?.subject || '-'}</h4>
                            <span className="history-period-chip">P{session.period}</span>
                          </div>
                          <div className="history-entry-bottom">
                            <span className={`badge badge-${session.status}`}>{session.status}</span>
                            <div className="history-session-stats">
                              <p className="history-session-present">
                                Present: {session.attendance_summary?.present ?? 0}
                                {` / `}
                                {session.attendance_summary?.total ?? 0}
                              </p>
                              <div className="history-session-modes">
                                <span className="history-mode-chip">
                                  Bio: {session.attendance_summary?.biometric ?? 0}
                                </span>
                                <span className="history-mode-chip">
                                  Manual: {session.attendance_summary?.manual_override ?? 0}
                                </span>
                                <span className="history-mode-chip">
                                  Auto Absent: {session.attendance_summary?.auto_absent ?? 0}
                                </span>
                              </div>
                              <div className="history-student-section">
                                <p className="history-student-label">Present students</p>
                                {historyPresentLoadingBySession[session.id] ? (
                                  <p className="history-student-empty">Loading students...</p>
                                ) : (historyPresentBySession[session.id] || []).length === 0 ? (
                                  <p className="history-student-empty">No present students.</p>
                                ) : (
                                  <div className="history-student-list">
                                    {(historyPresentBySession[session.id] || []).map((student) => (
                                      <div className="history-student-item" key={`${session.id}-${student.student_id}`}>
                                        <div className="history-student-meta">
                                          <span className="history-student-name">{student.full_name}</span>
                                          <span className="history-student-roll">{student.roll_number}</span>
                                        </div>
                                        <span className={`history-student-mode ${student.mode}`}>
                                          {student.mode === 'manual_override'
                                            ? 'Manual Override'
                                            : student.mode === 'biometric'
                                              ? 'Biometric'
                                              : 'Unknown (Legacy)'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
