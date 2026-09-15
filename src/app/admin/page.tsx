'use client';

import { useEffect, useMemo, useState } from 'react';
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
  const [listVisible, setListVisible] = useState(true);

  const [newRollNumber, setNewRollNumber] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newYear, setNewYear] = useState<(typeof YEAR_OPTIONS)[number]>('1');
  const [newPassword, setNewPassword] = useState('demo123456');

  const title = useMemo(
    () => (department ? `${department} HOD Admin Portal` : 'Admin Portal'),
    [department]
  );

  async function loadStudents(year = selectedYear, month = selectedMonth) {
    setLoading(true);
    setError('');
    setSuccess('');
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
  }

  useEffect(() => {
    void loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          roll_number: newRollNumber,
          full_name: newFullName,
          year: newYear,
          password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add student');
      }

      setSuccess(
        `Student added: ${data.student.full_name} (${data.student.roll_number}). Login email: ${data.student.email}`
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

  return (
    <div className="page teacher-app-shell">
      <div className="page-header teacher-app-header">
        <div className="teacher-title-wrap">
          <h1>{title}</h1>
          <span className="user-info">{adminName || 'Admin'}</span>
        </div>
        <button className="btn btn-outline btn-sm teacher-logout-btn" onClick={handleLogout}>
          Sign Out
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <div className="card-header">
          <h2>Department Student List</h2>
          <div className="flex gap-1">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setListVisible((prev) => !prev)}
              type="button"
            >
              {listVisible ? 'Hide List' : 'Show List'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={downloadCsv} type="button">
              Download CSV
            </button>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="year-filter">Year</label>
            <select
              id="year-filter"
              className="form-select"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value as (typeof YEAR_OPTIONS)[number])}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="month-filter">Month</label>
            <input
              id="month-filter"
              className="form-input"
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          onClick={() => void loadStudents(selectedYear, selectedMonth)}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Apply Filters'}
        </button>

        {listVisible ? (
          <div className="table-wrapper mt-2">
            <table>
              <thead>
                <tr>
                  <th>SL No</th>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Attendance % (Month)</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-dim">
                      No students found for this year.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr key={student.student_id}>
                      <td>{student.slno}</td>
                      <td>{student.roll_number}</td>
                      <td>{student.full_name}</td>
                      <td>
                        {student.attendance_percentage.toFixed(2)}%
                        <span className="text-dim text-sm">
                          {' '}({student.total_attendance}/{student.total_sessions})
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-dim text-sm mt-2">
            Student list is hidden. Click Show List to view all students.
          </p>
        )}
      </div>

      <div className="card mt-2">
        <h2>Add New Student</h2>
        <form onSubmit={addStudent} className="mt-2">
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="student-roll">Roll Number</label>
              <input
                id="student-roll"
                className="form-input"
                value={newRollNumber}
                onChange={(event) => setNewRollNumber(event.target.value)}
                placeholder="160524737018"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="student-year">Year</label>
              <select
                id="student-year"
                className="form-select"
                value={newYear}
                onChange={(event) => setNewYear(event.target.value as (typeof YEAR_OPTIONS)[number])}
              >
                {YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>
                    Year {year}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="student-name">Full Name</label>
            <input
              id="student-name"
              className="form-input"
              value={newFullName}
              onChange={(event) => setNewFullName(event.target.value)}
              placeholder="Student full name"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="student-password">Initial Password</label>
            <input
              id="student-password"
              className="form-input"
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Add Student'}
          </button>
        </form>
      </div>
    </div>
  );
}
