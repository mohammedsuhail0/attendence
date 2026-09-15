'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getMonthKeyInTimeZone } from '@/lib/utils';

type AdminStudent = {
  slno: number;
  student_id: string;
  roll_number: string;
  full_name: string;
  total_attendance: number;
  total_sessions: number;
  attendance_percentage: number;
};

const YEAR_OPTIONS = ['1', '2', '3', '4'] as const;

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [adminName, setAdminName] = useState('');
  const [department, setDepartment] = useState('');
  const [selectedYear, setSelectedYear] = useState<(typeof YEAR_OPTIONS)[number]>('1');
  const [selectedMonth, setSelectedMonth] = useState(getMonthKeyInTimeZone());
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [defaulterOnly, setDefaulterOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'roster' | 'enroll'>('overview');

  // New Student Form State
  const [newRollNumber, setNewRollNumber] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newYear, setNewYear] = useState<(typeof YEAR_OPTIONS)[number]>('1');
  const [newPassword, setNewPassword] = useState('demo123456');

  const title = useMemo(
    () => (department ? `${department} HOD Hub` : 'HOD Admin'),
    [department]
  );

  const loadStudents = useCallback(async (year = selectedYear, month = selectedMonth) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/students?year=${year}&month=${month}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load students');
      }
      setStudents(data.students || []);
      setDepartment(data.department || '');
      setAdminName(data.admin_name || '');
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load students';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    void loadStudents(selectedYear, selectedMonth);
  }, [selectedYear, selectedMonth, loadStudents]);

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll_number: newRollNumber.trim().toUpperCase(),
          full_name: newFullName.trim(),
          year: newYear,
          password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add student');
      }

      setSuccess(
        `✓ Enrolled: ${data.student.full_name} (${data.student.roll_number})`
      );
      setNewRollNumber('');
      setNewFullName('');
      setNewPassword('demo123456');
      setShowAddForm(false);

      await loadStudents(selectedYear, selectedMonth);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to add student';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }



  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchesSearch =
        s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.roll_number.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDefaulter = !defaulterOnly || s.attendance_percentage < 75;
      return matchesSearch && matchesDefaulter;
    });
  }, [students, searchQuery, defaulterOnly]);

  const defaulters = useMemo(() => {
    return students.filter((s) => s.attendance_percentage < 75);
  }, [students]);

  const avgAttendance = useMemo(() => {
    if (!students.length) return 0;
    const total = students.reduce((acc, s) => acc + s.attendance_percentage, 0);
    return Math.round(total / students.length);
  }, [students]);

  const defaulterCount = defaulters.length;

  function downloadCsv() {
    const headers = [
      'Sl No',
      'Roll Number',
      'Full Name',
      'Attended Classes',
      'Total Classes',
      'Attendance Percentage',
      'Status',
    ];
    const rows = filteredStudents.map((s, index) => [
      index + 1,
      `"${s.roll_number}"`,
      `"${s.full_name}"`,
      s.total_attendance,
      s.total_sessions,
      `${s.attendance_percentage}%`,
      s.attendance_percentage < 75 ? 'DEFAULTER' : 'REGULAR',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Attendance_Report_Year${selectedYear}_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="mobile-app-shell">
      {/* Top Mobile Header Bar */}
      <header className="mobile-app-header">
        <div className="brand-header-wrap">
          <h1>{title}</h1>
          <span className="user-info">{adminName || 'Dean / HOD'} • Year {selectedYear}</span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout} type="button">
          Sign Out
        </button>
      </header>

      {/* Main Tab Screen Content */}
      <main className={`mobile-app-content ${activeTab === 'overview' ? 'fit-screen' : ''}`}>
        {/* Banner Alerts */}
        {error && <div className="alert alert-error">⚠️ {error}</div>}
        {success && <div className="alert alert-success">✅ {success}</div>}

        {/* TAB 1: 📊 OVERVIEW (FIT SCREEN, ZERO SCROLL) */}
        {activeTab === 'overview' && (
          <div className="flex-col justify-between" style={{ height: '100%', gap: '0.65rem' }}>
            <div className="flex-col gap-1">
              {/* Cohort Year Filter Pills */}
              <div className="filter-pill-bar" style={{ marginBottom: '0.25rem' }}>
                {YEAR_OPTIONS.map((yr) => (
                  <button
                    key={yr}
                    onClick={() => setSelectedYear(yr)}
                    className={`filter-pill-btn ${selectedYear === yr ? 'active' : ''}`}
                    type="button"
                  >
                    Year {yr}
                  </button>
                ))}
              </div>

              {/* KPI Stats Cards */}
              <div className="student-kpi-grid" style={{ marginBottom: '0.25rem' }}>
                <div className="student-kpi-card">
                  <strong>{avgAttendance}%</strong>
                  <p>Cohort Avg Attendance</p>
                </div>
                <div className="student-kpi-card">
                  <strong className={defaulterCount > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                    {defaulterCount}
                  </strong>
                  <p>Defaulters (&lt;75%)</p>
                </div>
              </div>

              {/* Defaulters Shortlist Toggle */}
              <button
                onClick={() => setDefaulterOnly(!defaulterOnly)}
                className={`defaulter-toggle-btn ${defaulterOnly ? 'active' : ''}`}
                type="button"
                style={{ marginBottom: '0.25rem' }}
              >
                <span>🚨 Defaulters Shortlist</span>
                <span className={`badge ${defaulterOnly ? 'badge-absent' : 'badge-closed'}`}>
                  {defaulterOnly ? 'FILTER ACTIVE' : `${defaulterCount} flagged`}
                </span>
              </button>

              {/* Quick Shortlist Preview Card */}
              <div className="card" style={{ padding: '0.85rem', marginBottom: 0 }}>
                <div className="card-header" style={{ marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem' }}>High-Risk Shortlist (&lt;75%)</h3>
                  <span className="badge badge-absent">{defaulters.length} flagged</span>
                </div>
                <div className="roster-list" style={{ maxHeight: '130px' }}>
                  {defaulters.slice(0, 4).map((s) => (
                    <div key={s.student_id} className="roster-row" style={{ padding: '0.45rem 0.65rem' }}>
                      <div className="roster-name-col">
                        <div className="roster-name-text">{s.full_name}</div>
                        <div className="roster-roll-text">{s.roll_number}</div>
                      </div>
                      <span className="badge badge-absent">{s.attendance_percentage}%</span>
                    </div>
                  ))}
                  {defaulters.length === 0 && (
                    <p className="text-dim text-sm text-center py-2">No defaulters in this cohort! 🎉</p>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Full Roster Jump Button */}
            <button
              type="button"
              className="btn btn-secondary btn-block flex-between"
              onClick={() => setActiveTab('roster')}
            >
              <span>👥 View Full Cohort Roster</span>
              <span className="badge badge-active">{students.length} Students →</span>
            </button>
          </div>
        )}

        {/* TAB 2: 👥 COHORT ROSTER */}
        {activeTab === 'roster' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Cohort Year Filter Pills */}
            <div className="filter-pill-bar" style={{ marginBottom: '0.5rem' }}>
              {YEAR_OPTIONS.map((yr) => (
                <button
                  key={yr}
                  onClick={() => setSelectedYear(yr)}
                  className={`filter-pill-btn ${selectedYear === yr ? 'active' : ''}`}
                  type="button"
                >
                  Year {yr}
                </button>
              ))}
            </div>

            <div className="card-header">
              <div>
                <h2>Cohort Roster</h2>
                <p className="card-meta">
                  {filteredStudents.length} of {students.length} students
                </p>
              </div>
              <button className="btn btn-outline btn-sm" onClick={downloadCsv} type="button">
                📥 Export CSV
              </button>
            </div>

            <div className="form-group">
              <input
                type="text"
                placeholder="Search student or roll number..."
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="roster-list" style={{ flex: 1, maxHeight: 'none' }}>
              {filteredStudents.map((s) => {
                const isDefaulter = s.attendance_percentage < 75;
                return (
                  <div
                    key={s.student_id}
                    className="roster-row"
                    style={isDefaulter ? { borderLeft: '4px solid var(--danger)', background: 'var(--danger-light)' } : {}}
                  >
                    <div className="roster-name-col">
                      <div className="roster-name-text font-bold">{s.full_name}</div>
                      <div className="roster-roll-text">{s.roll_number} • {s.total_attendance}/{s.total_sessions} classes</div>
                    </div>

                    <span className={`badge ${isDefaulter ? 'badge-absent' : 'badge-present'}`}>
                      {s.attendance_percentage}%
                    </span>
                  </div>
                );
              })}

              {filteredStudents.length === 0 && (
                <p className="text-dim text-sm text-center py-6">No matching students found</p>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ➕ ENROLL STUDENT */}
        {activeTab === 'enroll' && (
          <div className="card">
            <div className="card-header">
              <h2>Enroll Student</h2>
              <span className="badge badge-active">Year {newYear}</span>
            </div>

            <form onSubmit={addStudent} className="mt-1">
              <div className="form-group">
                <label>Roll Number</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  placeholder="e.g. IT2401"
                  value={newRollNumber}
                  onChange={(e) => setNewRollNumber(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Alex Johnson"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Academic Year</label>
                <select
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value as (typeof YEAR_OPTIONS)[number])}
                  className="form-select"
                >
                  {YEAR_OPTIONS.map((yr) => (
                    <option key={yr} value={yr}>
                      Year {yr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Initial Password</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading || !newRollNumber || !newFullName}
                className="btn btn-primary btn-block"
              >
                {loading ? 'Enrolling...' : '⚡ Enroll Student'}
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Bottom Mobile Tab Bar */}
      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span>Overview</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'roster' ? 'active' : ''}`}
          onClick={() => setActiveTab('roster')}
        >
          <span>Directory</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'enroll' ? 'active' : ''}`}
          onClick={() => setActiveTab('enroll')}
        >
          <span>Enrollment</span>
        </button>
      </nav>
    </div>
  );
}
