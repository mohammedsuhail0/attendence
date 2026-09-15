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

  function downloadCsv() {
    window.location.href = `/api/admin/students/export?year=${selectedYear}&month=${selectedMonth}`;
  }

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

  const defaulterCount = students.filter((s) => s.attendance_percentage < 75).length;
  const avgAttendance = students.length > 0
    ? Math.round(students.reduce((acc, s) => acc + s.attendance_percentage, 0) / students.length)
    : 0;

  return (
    <div className="page">
      {/* Top Mobile Header */}
      <div className="page-header">
        <div className="brand-header-wrap">
          <h1>{title}</h1>
          <span className="user-info">{adminName || 'Department Head'} • Year {selectedYear}</span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout}>
          Sign Out
        </button>
      </div>

      {/* Banner Alerts */}
      {error && <div className="alert alert-error">⚠️ {error}</div>}
      {success && <div className="alert alert-success">✅ {success}</div>}

      {/* COHORT YEAR FILTER PILLS */}
      <div className="filter-pill-bar">
        {YEAR_OPTIONS.map((yr) => (
          <button
            key={yr}
            onClick={() => setSelectedYear(yr)}
            className={`filter-pill-btn ${selectedYear === yr ? 'active' : ''}`}
          >
            Year {yr}
          </button>
        ))}
      </div>

      {/* KPI STATS CARD */}
      <div className="student-kpi-grid">
        <div className="student-kpi-card">
          <strong>{avgAttendance}%</strong>
          <p>Cohort Avg Attendance</p>
        </div>
        <div className="student-kpi-card">
          <strong className={defaulterCount > 0 ? 'text-rose-700' : 'text-emerald-700'}>
            {defaulterCount}
          </strong>
          <p>Defaulters (&lt;75% Attendance)</p>
        </div>
      </div>

      {/* DEFAULTER QUICK FILTER TOGGLE */}
      <button
        onClick={() => setDefaulterOnly(!defaulterOnly)}
        className={`defaulter-toggle-btn ${defaulterOnly ? 'active' : ''}`}
        type="button"
      >
        <span>🚨 Defaulters Shortlist Filter</span>
        <span className={`badge ${defaulterOnly ? 'badge-absent' : 'badge-closed'}`}>
          {defaulterOnly ? 'FILTER ACTIVE' : `${defaulterCount} flagged`}
        </span>
      </button>

      {/* ENROLL STUDENT ACCORDION */}
      <div className="card">
        <div className="card-header">
          <h2>Enroll Student</h2>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowAddForm(!showAddForm)}
            type="button"
          >
            {showAddForm ? 'Cancel' : '+ New'}
          </button>
        </div>

        {showAddForm && (
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
              {loading ? 'Enrolling...' : 'Enroll Student'}
            </button>
          </form>
        )}
      </div>

      {/* MASTER STUDENT ROSTER */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Cohort Roster</h2>
            <p className="card-meta">
              Showing {filteredStudents.length} of {students.length} students
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

        <div className="roster-list">
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
            <p className="text-dim text-sm text-center py-4">No matching students found</p>
          )}
        </div>
      </div>
    </div>
  );
}
