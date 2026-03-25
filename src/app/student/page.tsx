'use client';

import { useState, useEffect } from 'react';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface AttendanceRecord {
  id: string;
  status: string;
  marked_at: string;
  attendance_sessions: {
    session_date: string;
    period: number;
    classes: {
      subject: string;
      department: string;
      section: string;
    };
  };
}

interface StudentProfile {
  full_name: string;
  roll_number: string | null;
  webauthn_credential: unknown | null;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function StudentDashboard() {
  const supabase = createClient();
  const router = useRouter();

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name, roll_number, webauthn_credential')
        .eq('id', user.id)
        .single();

      setProfile(p);
      setHasBiometric(Boolean(p?.webauthn_credential));

      const res = await fetch('/api/attendance/history');
      const data = await res.json();
      if (data.records) setRecords(data.records);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function registerBiometric() {
    setError('');
    setSuccess('');
    setBiometricBusy(true);

    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error('This browser does not support phone biometrics.');
      }

      const optionsRes = await fetch('/api/webauthn/register/options', {
        method: 'POST',
      });
      const optionsData = await optionsRes.json();

      if (!optionsRes.ok) {
        throw new Error(optionsData.error || 'Failed to create biometric registration.');
      }

      const registrationResponse = await startRegistration(optionsData.options);

      const verifyRes = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: registrationResponse }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Biometric registration failed.');
      }

      setHasBiometric(true);
      setSuccess('Biometric setup complete. You can now mark attendance.');
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to set up biometrics.'));
    } finally {
      setBiometricBusy(false);
    }
  }

  async function createBiometricAssertion(): Promise<unknown> {
    if (!browserSupportsWebAuthn()) {
      throw new Error('This browser does not support phone biometrics.');
    }

    const optionsRes = await fetch('/api/webauthn/authenticate/options', {
      method: 'POST',
    });
    const optionsData = await optionsRes.json();

    if (!optionsRes.ok) {
      throw new Error(optionsData.error || 'Unable to start biometric verification.');
    }

    return startAuthentication(optionsData.options);
  }

  async function submitAttendance(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!hasBiometric) {
        throw new Error('Set up biometrics first.');
      }

      const assertion = await createBiometricAssertion();

      const res = await fetch('/api/attendance/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.toUpperCase(),
          assertion,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit attendance.');
      }

      setSuccess('Attendance marked successfully.');
      setToken('');

      const res2 = await fetch('/api/attendance/history');
      const d2 = await res2.json();
      if (d2.records) setRecords(d2.records);
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to submit attendance.'));
    } finally {
      setLoading(false);
    }
  }

  // Stats
  const total = records.length;
  const present = records.filter((r) => r.status === 'present').length;
  const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

  // Subject-wise stats
  const subjectMap = new Map<string, { total: number; present: number }>();
  for (const r of records) {
    const subject = r.attendance_sessions?.classes?.subject || '-';
    const entry = subjectMap.get(subject) || { total: 0, present: 0 };
    entry.total++;
    if (r.status === 'present') entry.present++;
    subjectMap.set(subject, entry);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Student Dashboard</h1>
          <span className="user-info">
            {profile?.full_name} {profile?.roll_number ? `(${profile.roll_number})` : ''}
          </span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout}>
          Sign Out
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <h2>Biometric Setup</h2>
        {hasBiometric ? (
          <p className="text-dim text-sm mt-1">Biometric is active on this account.</p>
        ) : (
          <>
            <p className="text-dim text-sm mt-1">
              Set up fingerprint or face unlock once before marking attendance.
            </p>
            <button
              type="button"
              className="btn btn-outline mt-1"
              onClick={registerBiometric}
              disabled={biometricBusy}
            >
              {biometricBusy ? 'Setting up...' : 'Set Up Biometrics'}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Mark Attendance</h2>
        <form onSubmit={submitAttendance} className="mt-2">
          <div className="form-group">
            <label htmlFor="token-input">Enter Token (from teacher)</label>
            <input
              id="token-input"
              type="text"
              className="form-input"
              placeholder="e.g. A3F2B9"
              value={token}
              onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 6))}
              maxLength={6}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '1.5rem',
                textAlign: 'center',
                letterSpacing: '0.3em',
              }}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading || token.length !== 6 || !hasBiometric}
          >
            {loading ? 'Submitting...' : 'Verify Biometrics & Submit'}
          </button>
        </form>
      </div>

      <div className="grid-2 mt-2">
        <div className="card text-center">
          <p className="text-dim text-sm">Overall Attendance</p>
          <p
            style={{
              fontSize: '2.5rem',
              fontWeight: 800,
              color: percentage >= 75 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {percentage}%
          </p>
          <p className="text-dim text-sm">{present} / {total} classes</p>
        </div>
        <div className="card text-center">
          <p className="text-dim text-sm">Status</p>
          <p
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: percentage >= 75 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {percentage >= 75 ? 'Safe' : 'Low Attendance'}
          </p>
          <p className="text-dim text-sm">75% minimum required</p>
        </div>
      </div>

      {subjectMap.size > 0 && (
        <div className="card mt-2">
          <h2>Subject-wise Attendance</h2>
          <div className="table-wrapper mt-1">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Present</th>
                  <th>Total</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(subjectMap.entries()).map(([subject, stats]) => {
                  const pct = Math.round((stats.present / stats.total) * 100);
                  return (
                    <tr key={subject}>
                      <td>{subject}</td>
                      <td>{stats.present}</td>
                      <td>{stats.total}</td>
                      <td>
                        <span
                          style={{
                            color: pct >= 75 ? 'var(--success)' : 'var(--danger)',
                            fontWeight: 600,
                          }}
                        >
                          {pct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mt-2">
        <h2>Attendance History</h2>
        {records.length === 0 ? (
          <p className="text-dim text-sm mt-1">No records yet</p>
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
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.attendance_sessions?.session_date || '-'}</td>
                    <td>{r.attendance_sessions?.classes?.subject || '-'}</td>
                    <td>P{r.attendance_sessions?.period}</td>
                    <td>
                      <span className={`badge badge-${r.status}`}>
                        {r.status}
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

