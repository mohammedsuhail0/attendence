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

  // New Student Modal / Form State
  const [newRollNumber, setNewRollNumber] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newYear, setNewYear] = useState<(typeof YEAR_OPTIONS)[number]>('1');
  const [newPassword, setNewPassword] = useState('demo123456');

  const title = useMemo(
    () => (department ? `${department} Department HOD Hub` : 'HOD Command Center'),
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
        `✓ Student enrolled: ${data.student.full_name} (${data.student.roll_number})`
      );
      setNewRollNumber('');
      setNewFullName('');
      setNewPassword('demo123456');

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

  function downloadCsv() {
    window.location.href = `/api/admin/students/export?year=${selectedYear}&month=${selectedMonth}`;
  }

  // Filtered student list
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchesSearch =
        s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.roll_number.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (defaulterOnly && s.attendance_percentage >= 75) return false;
      return true;
    });
  }, [students, searchQuery, defaulterOnly]);

  // Analytics
  const totalCount = students.length;
  const defaulterCount = students.filter((s) => s.attendance_percentage < 75).length;
  const highPerformersCount = students.filter((s) => s.attendance_percentage >= 90).length;
  const avgAttendance = totalCount > 0
    ? Math.round(students.reduce((acc, s) => acc + s.attendance_percentage, 0) / totalCount)
    : 0;

  return (
    <div className="viewport-app">
      {/* Top Header Bar */}
      <header className="viewport-header">
        <div className="header-brand">
          <div className="brand-badge">
            <span className="badge-dot pulse-emerald"></span>
            HOD COMMAND
          </div>
          <div className="header-title-group">
            <h1>{title}</h1>
            <span className="text-secondary text-xs">
              Logged in as {adminName || 'Department Head'} • Year {selectedYear} Cohort
            </span>
          </div>
        </div>

        <div className="header-actions">
          {/* Cohort Year Pills */}
          <div className="mode-toggle-pill">
            {YEAR_OPTIONS.map((yr) => (
              <button
                key={yr}
                onClick={() => setSelectedYear(yr)}
                className={`toggle-tab ${selectedYear === yr ? 'active' : ''}`}
              >
                Year {yr}
              </button>
            ))}
          </div>

          <div className="header-divider"></div>

          <button onClick={downloadCsv} className="btn-header" title="Export CSV Report">
            📥 Export Report
          </button>

          <button onClick={handleLogout} className="btn-header btn-header-danger">
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Viewport Content */}
      <div className="viewport-content">
        {/* Banner Notifications */}
        {error && (
          <div className="alert-banner alert-banner-error">
            <span>⚠️ {error}</span>
            <button onClick={() => setError('')} className="alert-close">×</button>
          </div>
        )}
        {success && (
          <div className="alert-banner alert-banner-success">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="alert-close">×</button>
          </div>
        )}

        <div className="viewport-grid grid-admin">
          {/* LEFT BENTO: Analytics & Student Enrollment */}
          <div className="bento-col">
            {/* KPI Summary Card */}
            <section className="bento-card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Cohort Overview</h2>
                  <p className="card-subtitle">Year {selectedYear} Attendance KPIs</p>
                </div>
                <span className="badge-light">{selectedMonth}</span>
              </div>

              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="stat-card-clean">
                    <span className="stat-label">Total Students</span>
                    <span className="stat-val text-slate-800">{totalCount}</span>
                  </div>
                  <div className="stat-card-clean">
                    <span className="stat-label">Cohort Average</span>
                    <span className={`stat-val ${avgAttendance >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {avgAttendance}%
                    </span>
                  </div>
                  <div className="stat-card-clean">
                    <span className="stat-label">Defaulters (&lt;75%)</span>
                    <span className={`stat-val ${defaulterCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {defaulterCount}
                    </span>
                  </div>
                  <div className="stat-card-clean">
                    <span className="stat-label">Top Performers</span>
                    <span className="stat-val text-indigo-600">{highPerformersCount}</span>
                  </div>
                </div>

                {/* Defaulter Quick Filter Toggle */}
                <button
                  onClick={() => setDefaulterOnly(!defaulterOnly)}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-between ${
                    defaulterOnly
                      ? 'bg-rose-50 text-rose-700 border-rose-200 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>🚨 Defaulters Shortlist Filter</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${defaulterOnly ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    {defaulterOnly ? 'ACTIVE' : `${defaulterCount} flagged`}
                  </span>
                </button>
              </div>
            </section>

            {/* Enroll New Student Card */}
            <section className="bento-card bento-card-flex">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Enroll New Student</h2>
                  <p className="card-subtitle">Add to {department || 'Department'}</p>
                </div>
              </div>

              <div className="p-4 overflow-y-auto">
                <form onSubmit={addStudent} className="control-form">
                  <div className="form-group">
                    <label className="form-label">Roll Number</label>
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
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Alex Johnson"
                      value={newFullName}
                      onChange={(e) => setNewFullName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label className="form-label">Academic Year</label>
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

                    <div className="form-group flex-1">
                      <label className="form-label">Default Password</label>
                      <input
                        type="text"
                        className="form-input font-mono bg-slate-50 text-slate-500"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !newRollNumber || !newFullName}
                    className="btn-primary w-full py-2.5 text-xs font-semibold shadow-sm"
                  >
                    {loading ? 'Enrolling...' : '+ Enroll Student'}
                  </button>
                </form>
              </div>
            </section>
          </div>

          {/* RIGHT BENTO: Master Cohort Roster */}
          <section className="bento-card col-broadcast">
            <div className="card-header">
              <div>
                <h2 className="card-title">Student Cohort Master Roster</h2>
                <p className="card-subtitle">
                  Showing {filteredStudents.length} of {students.length} enrolled students
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Search input */}
                <input
                  type="text"
                  placeholder="Search name or roll..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="roster-search-input py-1 px-2.5 text-xs rounded-lg border border-slate-200"
                />

                {/* Month input */}
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="py-1 px-2 text-xs rounded-lg border border-slate-200 bg-white font-mono"
                />
              </div>
            </div>

            <div className="archive-table-container">
              <table className="archive-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Roll Number</th>
                    <th>Full Name</th>
                    <th>Attended / Total</th>
                    <th>Attendance %</th>
                    <th>Academic Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s, index) => {
                    const isDefaulter = s.attendance_percentage < 75;
                    return (
                      <tr key={s.student_id} className={isDefaulter ? 'bg-rose-50/40' : ''}>
                        <td className="text-slate-400 font-mono text-xs">{index + 1}</td>
                        <td className="font-mono font-bold text-slate-800">{s.roll_number}</td>
                        <td className="font-medium text-slate-800">{s.full_name}</td>
                        <td className="font-mono text-xs font-semibold">
                          <span className="text-emerald-600">{s.total_attendance}</span> / {s.total_sessions}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className={`font-mono font-bold text-xs ${isDefaulter ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {s.attendance_percentage}%
                            </span>
                            <div className="w-16 progress-bar-container">
                              <div
                                className={`progress-bar-fill ${isDefaulter ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                style={{ width: `${s.attendance_percentage}%` }}
                              ></div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`status-badge-sm ${isDefaulter ? 'badge-closed' : 'badge-active'}`}>
                            {isDefaulter ? '⚠️ Defaulter (<75%)' : '✓ Good Standing'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredStudents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400 text-xs">
                        {loading ? 'Loading cohort data...' : 'No matching students found in this cohort.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
