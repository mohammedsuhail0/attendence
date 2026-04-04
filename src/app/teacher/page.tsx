'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { Class, AttendanceSession } from '@/types/database';
import { getDateStringInTimeZone } from '@/lib/utils';

const DEPARTMENT_OPTIONS = ['IT', 'CSE', 'AIDS', 'Civil', 'Mech'] as const;
const YEAR_OPTIONS = ['1', '2', '3', '4'] as const;

function getClassYear(cls: Class) {
  // Keep old demo data working while section values are moved from A/B labels to year numbers.
  return cls.section === 'A' ? '1' : cls.section;
}

type AttendanceRow = {
  status: string;
  mark_mode?: string | null;
  profiles: { full_name: string; roll_number: string };
};

type ManualStudent = {
  student_id: string;
  full_name: string;
  roll_number: string;
  email: string;
  photo_path: string | null;
  photo_url: string | null;
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
  const [attendanceList, setAttendanceList] = useState<AttendanceRow[]>([]);
  const [manualStudents, setManualStudents] = useState<ManualStudent[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSavingId, setManualSavingId] = useState<string | null>(null);
  const [manualSearch, setManualSearch] = useState('');
  const [showManualList, setShowManualList] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewingHistoryParams, setViewingHistoryParams] = useState<{ id: string; fetching: boolean } | null>(null);
  const [historyAttendanceList, setHistoryAttendanceList] = useState<AttendanceRow[]>([]);

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

  const filteredManualStudents = manualStudents.filter((student) => {
    const queryText = manualSearch.trim().toLowerCase();
    if (!queryText) return true;

    const queryDigits = queryText.replace(/\D/g, '');
    const studentRoll = student.roll_number.toLowerCase();
    const studentRollDigits = studentRoll.replace(/\D/g, '');

    if (queryDigits && studentRollDigits.endsWith(queryDigits)) return true;

    return (
      student.full_name.toLowerCase().includes(queryText) ||
      studentRoll.includes(queryText) ||
      student.email.toLowerCase().includes(queryText)
    );
  });



  const loadManualStudents = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId || activeSession?.id;
      if (!targetSessionId) return;
      setManualLoading(true);
      const res = await fetch(`/api/sessions/${targetSessionId}/manual-override`);
      const data = await res.json();
      setManualLoading(false);

      if (!res.ok) {
        setError(data.error || 'Failed to load students for manual override');
        return;
      }

      setManualStudents(data.students || []);
    },
    [activeSession?.id]
  );

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

  useEffect(() => {
    if (!activeSession || activeSession.status === 'closed') return;
    loadManualStudents(activeSession.id);
  }, [activeSession, loadManualStudents]);

  async function markManualPresent(studentId: string) {
    if (!activeSession) return;
    setError('');
    setSuccess('');
    setManualSavingId(studentId);

    const res = await fetch(`/api/sessions/${activeSession.id}/manual-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId }),
    });

    const data = await res.json();
    setManualSavingId(null);

    if (!res.ok) {
      setError(data.error || 'Manual override failed');
      return;
    }

    setSuccess('Attendance marked via manual override');

    const [attendanceRes] = await Promise.all([
      fetch(`/api/sessions/${activeSession.id}/attendance`),
      loadManualStudents(activeSession.id),
    ]);
    const attendanceData = await attendanceRes.json();
    if (attendanceData.records) setAttendanceList(attendanceData.records);
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
    setManualSearch('');
    setAttendanceList([]);
    loadManualStudents(data.session.id);
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
      setManualSearch('');
      setAttendanceList([]);
      setSuccess(`Session closed. Present: ${data.present}, Absent: ${data.absent}`);
      const res2 = await fetch('/api/sessions');
      const d2 = await res2.json();
      if (d2.sessions) setSessions(d2.sessions);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function viewSessionHistory(sessionId: string) {
    if (viewingHistoryParams?.id === sessionId) {
      setViewingHistoryParams(null);
      return;
    }
    setViewingHistoryParams({ id: sessionId, fetching: true });
    setHistoryAttendanceList([]);
    const res = await fetch(`/api/sessions/${sessionId}/attendance`);
    const data = await res.json();
    if (data.records) {
      setHistoryAttendanceList(data.records);
    }
    setViewingHistoryParams({ id: sessionId, fetching: false });
  }

  const groupedSessions = sessions.reduce((acc, session) => {
    const subject = session.classes?.subject || 'Unknown Subject';
    if (!acc[subject]) {
      acc[subject] = [];
    }
    acc[subject].push(session);
    return acc;
  }, {} as Record<string, typeof sessions>);

  return (
    <div className="page">
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

      {activeSession && (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-header">
            <h2>Active Session</h2>
            <span className="badge badge-active">LIVE</span>
          </div>

          <div className="token-display">
            <p className="text-dim text-sm">Share this token with students</p>
            <div className="token-code">{token}</div>
            <p className={`token-timer ${timeLeft > 0 ? 'active' : 'expired'}`}>
              {timeLeft > 0 ? `${timeLeft}s remaining` : 'Token expired'}
            </p>
          </div>

          <div className="flex-between mt-2">
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
                      <th>Mode</th>
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
                        <td>{record.mark_mode || 'biometric'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="manual-override mt-3">
            <div className="flex-between">
              <h3>Manual Override (Photo)</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {showManualList && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setShowManualList(false)}
                  >
                    Hide List
                  </button>
                )}
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    loadManualStudents();
                    setShowManualList(true);
                  }}
                  disabled={manualLoading}
                >
                  {manualLoading ? 'Refreshing...' : 'Refresh List'}
                </button>
              </div>
            </div>
            <p className="text-dim text-sm mt-1">
              Use when a student cannot submit from phone. Verify face and mark present.
            </p>

            <div className="form-group mt-2">
              <label htmlFor="manual-search">Search Student</label>
              <input
                id="manual-search"
                className="form-input"
                placeholder="Search by full roll, last digits (e.g. 047), name, or email"
                value={manualSearch}
                onChange={(e) => {
                  setManualSearch(e.target.value);
                  setShowManualList(true);
                }}
                onFocus={() => setShowManualList(true)}
              />
            </div>

            {showManualList && (
              <div className="mt-2">
                {manualLoading ? (
              <p className="text-dim text-sm">Loading students...</p>
            ) : filteredManualStudents.length === 0 ? (
              <p className="text-dim text-sm">No students match your search.</p>
            ) : (
              <div className="table-wrapper mt-1">
                <table>
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Roll No</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredManualStudents.map((student) => (
                      <tr key={student.student_id}>
                        <td>
                          {student.photo_url ? (
                            <img
                              className="manual-photo"
                              src={student.photo_url}
                              alt={student.full_name}
                            />
                          ) : (
                            <div className="manual-photo-placeholder">No Photo</div>
                          )}
                        </td>
                        <td>{student.roll_number || '-'}</td>
                        <td>{student.full_name || '-'}</td>
                        <td>
                          <span className={`badge badge-${student.attendance_status === 'not_marked' ? 'closed' : student.attendance_status}`}>
                            {student.attendance_status === 'not_marked'
                              ? 'not marked'
                              : student.attendance_status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={
                              student.attendance_status === 'present' ||
                              manualSavingId === student.student_id
                            }
                            onClick={() => markManualPresent(student.student_id)}
                          >
                            {manualSavingId === student.student_id
                              ? 'Marking...'
                              : student.attendance_status === 'present'
                                ? 'Present'
                                : 'Mark Present'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
              </div>
            )}
          </div>
        </div>
      )}

      {!activeSession && (
        <div className="card">
          <h2>Start New Session</h2>
          <form onSubmit={createSession} className="mt-2">
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

      <div className="card mt-3">
        <h2>Session History</h2>
        {sessions.length === 0 ? (
          <p className="text-dim text-sm mt-1">No sessions yet</p>
        ) : (
          Object.entries(groupedSessions).map(([subject, subjectSessions]) => (
            <div key={subject} className="mt-4">
              <h3 className="mb-2" style={{ borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--primary)' }}>
                {subject}
              </h3>
              <div className="table-wrapper mt-1">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>P/A</th>
                      <th>Bio</th>
                      <th>Manual</th>
                      <th>Auto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectSessions.map((session) => (
                      <React.Fragment key={session.id}>
                        <tr 
                          onClick={() => viewSessionHistory(session.id)}
                          style={{ cursor: 'pointer' }}
                          title="Click to view detailed attendance list"
                        >
                          <td>{session.session_date}</td>
                          <td>P{session.period}</td>
                          <td>
                            <span className={`badge badge-${session.status}`}>
                              {session.status}
                            </span>
                          </td>
                          <td>
                            {session.attendance_summary
                              ? `${session.attendance_summary.present}/${session.attendance_summary.absent}`
                              : '-'}
                          </td>
                          <td>{session.attendance_summary?.biometric ?? '-'}</td>
                          <td>{session.attendance_summary?.manual_override ?? '-'}</td>
                          <td>{session.attendance_summary?.auto_absent ?? '-'}</td>
                        </tr>
                        {viewingHistoryParams?.id === session.id && (
                          <tr>
                            <td colSpan={7} style={{ padding: '0', backgroundColor: 'var(--bg-accent, #fafafa)' }}>
                              <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                                {viewingHistoryParams.fetching ? (
                                  <p className="text-dim text-sm text-center my-2">Loading attendance list...</p>
                                ) : historyAttendanceList.length === 0 ? (
                                  <p className="text-dim text-sm text-center my-2">No attendance records found.</p>
                                ) : (
                                  <div className="table-wrapper" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                    <table style={{ fontSize: '0.85rem', margin: 0, border: '1px solid var(--border)' }}>
                                      <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'var(--bg)' }}>
                                        <tr>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Roll No</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Name</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Status</th>
                                          <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Mode</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {historyAttendanceList.map((record, index) => (
                                          <tr key={index}>
                                            <td style={{ padding: '0.5rem' }}>{record.profiles?.roll_number || '-'}</td>
                                            <td style={{ padding: '0.5rem' }}>{record.profiles?.full_name || '-'}</td>
                                            <td style={{ padding: '0.5rem' }}>
                                              <span className={`badge badge-${record.status}`}>{record.status}</span>
                                            </td>
                                            <td style={{ padding: '0.5rem' }}>{record.mark_mode || 'biometric'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
