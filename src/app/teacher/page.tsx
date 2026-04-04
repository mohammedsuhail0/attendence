'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
      if (d2.sessions) setSessions(d2.sessions);
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
      setManualStudents([]);
      setManualQuery('');
      setSuccess(`Session closed. Present: ${data.present}, Absent: ${data.absent}`);
      const res2 = await fetch('/api/sessions');
      const d2 = await res2.json();
      if (d2.sessions) setSessions(d2.sessions);
    }
  }

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
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{formatDisplayDate(session.session_date)}</td>
                    <td>{session.classes?.subject || '-'}</td>
                    <td>P{session.period}</td>
                    <td>
                      <span className={`badge badge-${session.status}`}>
                        {session.status}
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
