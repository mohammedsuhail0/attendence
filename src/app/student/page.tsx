'use client';

import { useState, useEffect } from 'react';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// --- Icons ---
const NotificationIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
);
const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
);
const HomeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
);
const BookIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
);
const HistoryIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
);
const UserIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
);
const InfoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
);

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
  const [biometricReady, setBiometricReady] = useState<boolean | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [currentTab, setCurrentTab] = useState<'home' | 'subjects' | 'history' | 'profile'>('subjects');

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

  useEffect(() => {
    let cancelled = false;

    async function checkBiometricSupport() {
      const secureContext = window.isSecureContext;
      const webAuthnSupported = browserSupportsWebAuthn();
      const platformSupported =
        secureContext && webAuthnSupported
          ? await platformAuthenticatorIsAvailable()
          : false;

      if (!cancelled) {
        setBiometricReady(secureContext && webAuthnSupported && platformSupported);
      }
    }

    checkBiometricSupport();

    return () => {
      cancelled = true;
    };
  }, []);

  function requireBiometricSupport() {
    if (biometricReady === null) {
      throw new Error('Checking biometric support. Please try again in a moment.');
    }

    if (!biometricReady) {
      throw new Error(
        'This phone or browser cannot complete biometrics on this origin. Use HTTPS in Safari or Chrome with device biometrics enabled.'
      );
    }
  }

  async function registerBiometric() {
    setError('');
    setSuccess('');
    setBiometricBusy(true);

    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error('This browser does not support phone biometrics.');
      }
      requireBiometricSupport();

      const optionsRes = await fetch('/api/webauthn/register/options', {
        method: 'POST',
        credentials: 'include',
      });
      const optionsData = await optionsRes.json();

      if (!optionsRes.ok) {
        throw new Error(optionsData.error || 'Failed to create biometric registration.');
      }

      const registrationResponse = await startRegistration(optionsData.options);

      const verifyRes = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
    requireBiometricSupport();

    const optionsRes = await fetch('/api/webauthn/authenticate/options', {
      method: 'POST',
      credentials: 'include',
    });
    const optionsData = await optionsRes.json();

    if (!optionsRes.ok) {
      if (optionsRes.status === 401 && optionsData.error === 'Unauthorized') {
        throw new Error('Your session has expired. Please sign out and log in again.');
      }
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
        credentials: 'include',
        body: JSON.stringify({
          token: token.toUpperCase(),
          assertion,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 && data.error === 'Unauthorized') {
          throw new Error('Your session has expired. Please sign out and log in again.');
        }
        throw new Error(data.error || 'Failed to submit attendance.');
      }

      setSuccess('Attendance marked successfully.');
      setToken('');

      const res2 = await fetch('/api/attendance/history');
      const d2 = await res2.json();
      if (d2.records) setRecords(d2.records);
      
      // Auto-switch to subjects after success
      setTimeout(() => setCurrentTab('subjects'), 1500);
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to submit attendance.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // Statistics Calculation
  const total = records.length;
  const present = records.filter((r) => r.status === 'present').length;
  const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

  const subjectMap = new Map<string, { total: number; present: number }>();
  for (const r of records) {
    const subjectName = r.attendance_sessions?.classes?.subject || 'Unknown';
    const entry = subjectMap.get(subjectName) || { total: 0, present: 0 };
    entry.total++;
    if (r.status === 'present') entry.present++;
    subjectMap.set(subjectName, entry);
  }

  const subjects = Array.from(subjectMap.entries()).map(([name, stats]) => {
    // Attempt to extract prefix (like MAT101) or generate one
    const codeMatch = name.match(/^[A-Z]{2,4}\d{2,4}/);
    const code = codeMatch ? codeMatch[0] : (name.substring(0, 3).toUpperCase() + '101');
    const displayName = name.replace(/^[A-Z]{2,4}\d{2,4}\s*(-|:)?\s*/, '');
    const pct = Math.round((stats.present / stats.total) * 100);
    return { name: displayName, code, ...stats, pct };
  });

  return (
    <div className="scholarly-page sc-animate-up">
      {/* Header */}
      <header className="sc-header">
        <div className="sc-profile-box">
          <img 
            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile?.full_name || 'Student'}`} 
            alt="Profile" 
          />
          <h1 className="brand-name">Scholarly Atelier</h1>
        </div>
        <div className="sc-notification">
          <NotificationIcon />
        </div>
      </header>

      {/* Main Content Area */}
      <main>
        {currentTab === 'subjects' && (
          <>
            <div className="sc-title-group">
              <h2>Subject-wise Attendance</h2>
              <p>Semester II • Spring 2024</p>
            </div>

            <div className="sc-summary-grid">
              <div className="sc-card-aggregate">
                <span className="sc-label">Aggregate Attendance</span>
                <span className="sc-value-xl">{percentage}%</span>
                <p className="sc-note">
                  {percentage >= 75 
                    ? "🎉 On track for Dean's List"
                    : "⚠️ Below required 75%"
                  }
                </p>
              </div>
              <div className="sc-card-total">
                <div className="sc-icon-box"><CalendarIcon /></div>
                <div>
                  <span className="sc-label">Total Ratio</span>
                  <span className="sc-value-lg">{present}/{total}</span>
                </div>
              </div>
            </div>

            <section>
              <div className="sc-section-header">
                <h3>Course Breakdown</h3>
                <span className="sc-timestamp">Last updated: Just now</span>
              </div>

              {subjects.length === 0 ? (
                <div className="sc-course-card text-center">
                  <p className="text-dim">No course data available yet.</p>
                </div>
              ) : (
                subjects.map((sub) => (
                  <div key={sub.code} className="sc-course-card">
                    <div className="sc-course-top">
                      <span className="sc-course-code">{sub.code}</span>
                      <span className={`sc-pct-badge ${sub.pct >= 75 ? 'good' : 'bad'}`}>
                        {sub.pct}%
                      </span>
                    </div>
                    <h4 className="sc-course-name">{sub.name}</h4>
                    <div className="sc-course-bottom">
                      <span>Attended: {sub.present}/{sub.total} classes</span>
                      <span className={`sc-course-status ${sub.pct < 75 ? 'warning' : ''}`}>
                        {sub.pct >= 75 ? 'Good Standing' : 'Action Required'}
                      </span>
                    </div>
                    <div className="sc-progress-track">
                      <div 
                        className={`sc-progress-bar ${sub.pct >= 75 ? 'good' : 'bad'}`}
                        style={{ width: `${sub.pct}%` }}
                      />
                    </div>
                  </div>
                )
              ))}

              <div className="sc-policy-card">
                <div className="sc-policy-top">
                  <InfoIcon />
                  <span className="sc-label" style={{ marginBottom: 0, opacity: 1, color: '#fff' }}>Attendance Policy</span>
                </div>
                <p>
                  A minimum of 75% attendance is mandatory for semester eligibility. 
                  Below 75%, students may be barred from final examinations.
                </p>
              </div>
            </section>
          </>
        )}

        {currentTab === 'home' && (
          <>
            <div className="sc-title-group">
              <h2>Welcome, {profile?.full_name?.split(' ')[0] || 'Student'}</h2>
              <p>Ready for today&apos;s sessions?</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            <div className="sc-course-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '1rem', color: 'var(--scholarly-primary)' }}>
                Mark Attendance
              </h3>
              <form onSubmit={submitAttendance}>
                <div className="form-group">
                  <label>Session Token (from Teacher)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="E.G. A3F2"
                    value={token}
                    onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 4))}
                    maxLength={4}
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '2rem',
                      textAlign: 'center',
                      letterSpacing: '0.4em',
                      height: '60px',
                      background: '#F9F9F9',
                      border: '2px dashed var(--scholarly-border)'
                    }}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  style={{ height: '50px', borderRadius: '15px' }}
                  disabled={loading || token.length !== 4 || !hasBiometric || biometricReady !== true}
                >
                  {loading ? 'Processing...' : 'Verify & Mark'}
                </button>
                {!hasBiometric && (
                  <p className="text-dim text-center mt-1 text-sm">
                    ⚠️ Setup biometrics in profile/home first
                  </p>
                )}
              </form>
            </div>

            <div className="sc-course-card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: '0.5rem', color: 'var(--scholarly-primary)' }}>
                Biometric Identity
              </h3>
              <p className="sc-timestamp" style={{ marginBottom: '1rem' }}>
                Secure passkey-based attendance verification
              </p>
              {hasBiometric ? (
                <div className="badge badge-present" style={{ padding: '0.5rem 1rem' }}>
                  ✓ Passkey Registered
                </div>
              ) : (
                <>
                  <p className="text-dim text-sm mb-2">
                    Enable device biometrics for secure, one-tap attendance.
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline btn-block"
                    onClick={registerBiometric}
                    disabled={biometricBusy || biometricReady !== true}
                  >
                    {biometricBusy ? 'Creating Passkey...' : 'Set Up Passkey'}
                  </button>
                  {biometricReady === false && (
                    <p className="alert alert-error mt-2">
                       This device/browser does not support biometrics in this context.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {currentTab === 'history' && (
          <>
            <div className="sc-title-group">
              <h2>Attendance Log</h2>
              <p>Complete history of your activity</p>
            </div>

            {records.length === 0 ? (
              <div className="sc-course-card text-center">
                <p className="text-dim">No attendance logs found yet.</p>
              </div>
            ) : (
              <div className="sc-course-card" style={{ padding: '0.5rem' }}>
                <div className="table-wrapper">
                  <table style={{ background: 'transparent' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Subject</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={r.id}>
                          <td style={{ fontSize: '0.75rem', fontWeight: 600 }}>{r.attendance_sessions?.session_date}</td>
                          <td style={{ fontSize: '0.75rem' }}>{r.attendance_sessions?.classes?.subject}</td>
                          <td>
                            <span className={`badge badge-${r.status}`} style={{ fontSize: '0.65rem' }}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {currentTab === 'profile' && (
          <>
            <div className="sc-title-group">
              <h2>Student Profile</h2>
              <p>Account and system settings</p>
            </div>

            <div className="sc-course-card text-center">
              <img 
                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile?.full_name || 'Student'}`} 
                alt="Profile" 
                style={{ width: '100px', height: '100px', borderRadius: '50%', marginBottom: '1rem', border: '5px solid var(--scholarly-secondary)' }}
              />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 800 }}>{profile?.full_name}</h3>
              <p className="sc-timestamp">Roll No: {profile?.roll_number || 'N/A'}</p>
              
              <div className="mt-3">
                <button className="btn btn-outline btn-block mb-2" onClick={() => setCurrentTab('home')}>
                  Identity Settings
                </button>
                <button className="btn btn-danger btn-block" onClick={handleLogout}>
                  Sign Out of Atelier
                </button>
              </div>
            </div>

            <div className="sc-course-card">
              <h4 className="sc-course-code">System Info</h4>
              <p className="text-sm mt-1">Smart Attendance v2.4.0-Atelier</p>
              <p className="text-sm text-dim">Active Session: {profile?.roll_number ? 'Authorized' : 'Checking...'}</p>
            </div>
          </>
        )}
      </main>

      {/* Navigation */}
      <nav className="sc-navbar">
        <button 
          className={`sc-nav-item ${currentTab === 'home' ? 'active' : ''}`}
          onClick={() => setCurrentTab('home')}
        >
          <div className="sc-nav-icon"><HomeIcon /></div>
          <span>Home</span>
        </button>
        <button 
          className={`sc-nav-item ${currentTab === 'subjects' ? 'active' : ''}`}
          onClick={() => setCurrentTab('subjects')}
        >
          <div className="sc-nav-icon"><BookIcon /></div>
          <span>Subjects</span>
        </button>
        <button 
          className={`sc-nav-item ${currentTab === 'history' ? 'active' : ''}`}
          onClick={() => setCurrentTab('history')}
        >
          <div className="sc-nav-icon"><HistoryIcon /></div>
          <span>History</span>
        </button>
        <button 
          className={`sc-nav-item ${currentTab === 'profile' ? 'active' : ''}`}
          onClick={() => setCurrentTab('profile')}
        >
          <div className="sc-nav-icon"><UserIcon /></div>
          <span>Profile</span>
        </button>
      </nav>
    </div>
  );
}
