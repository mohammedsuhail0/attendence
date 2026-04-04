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
  photo_path?: string | null;
  webauthn_credential: unknown | null;
}

interface LeaderboardEntry {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  photo_path: string | null;
  total: number;
  present: number;
  percentage: number;
}

const DEFAULT_AVATARS = [
  'https://api.dicebear.com/9.x/notionists/svg?seed=Atlas',
  'https://api.dicebear.com/9.x/notionists/svg?seed=Nova',
  'https://api.dicebear.com/9.x/notionists/svg?seed=Iris',
  'https://api.dicebear.com/9.x/notionists/svg?seed=Zen',
  'https://api.dicebear.com/9.x/notionists/svg?seed=Jade',
  'https://api.dicebear.com/9.x/notionists/svg?seed=Orion',
  'https://api.dicebear.com/9.x/notionists/svg?seed=Luna',
  'https://api.dicebear.com/9.x/notionists/svg?seed=River',
];

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
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'subjects' | 'leaderboard' | 'profile'>('subjects');
  const [profileImage, setProfileImage] = useState<string>(DEFAULT_AVATARS[0]);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  async function loadLeaderboard() {
    setLeaderboardLoading(true);
    try {
      const res = await fetch('/api/attendance/leaderboard');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load leaderboard');
      setLeaderboard(data.leaderboard || []);
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to load leaderboard'));
    } finally {
      setLeaderboardLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name, roll_number, photo_path, webauthn_credential')
        .eq('id', user.id)
        .single();

      setProfile(p);
      setHasBiometric(Boolean(p?.webauthn_credential));

      const localAvatar = window.localStorage.getItem(`student-avatar-${user.id}`);
      setProfileImage(localAvatar || p?.photo_path || DEFAULT_AVATARS[0]);

      const res = await fetch('/api/attendance/history');
      const data = await res.json();
      if (data.records) setRecords(data.records);

      await loadLeaderboard();
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
    requireBiometricSupport();

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

  function saveProfileImage(imageUrl: string) {
    setProfileImage(imageUrl);
    if (currentUserId) {
      window.localStorage.setItem(`student-avatar-${currentUserId}`, imageUrl);
    }
    setSuccess('Profile image updated.');
    setError('');
  }

  function onGalleryPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (!value) {
        setError('Unable to read selected image.');
        return;
      }
      saveProfileImage(value);
    };
    reader.onerror = () => {
      setError('Unable to read selected image.');
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="page student-page">
      <div className="student-topbar">
        <div className="student-brand-wrap">
          <img src={profileImage} alt="Profile" className="student-avatar" />
          <div className="student-brand">Scholarly Atelier</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleLogout}>
          Sign Out
        </button>
      </div>

      <header className="student-hero">
        <h1>Subject-wise Attendance</h1>
        <p className="student-semester">Semester II • Spring 2024</p>
        <p className="student-subtitle">
          {profile?.full_name} {profile?.roll_number ? `• ${profile.roll_number}` : ''}
        </p>
      </header>

      <div className="student-tabbar">
        <button
          className={`student-tab ${activeTab === 'subjects' ? 'student-tab-active' : ''}`}
          onClick={() => setActiveTab('subjects')}
          type="button"
        >
          <span className="student-tab-icon">SUB</span>
          <span className="student-tab-label">Subjects</span>
        </button>
        <button
          className={`student-tab ${activeTab === 'leaderboard' ? 'student-tab-active' : ''}`}
          onClick={() => setActiveTab('leaderboard')}
          type="button"
        >
          <span className="student-tab-icon">RANK</span>
          <span className="student-tab-label">Leaderboard</span>
        </button>
        <button
          className={`student-tab ${activeTab === 'profile' ? 'student-tab-active' : ''}`}
          onClick={() => setActiveTab('profile')}
          type="button"
        >
          <span className="student-tab-icon">ME</span>
          <span className="student-tab-label">Profile</span>
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {activeTab === 'subjects' && (
        <>
      <section className="student-summary-grid">
        <article className="card summary-main">
          <p className="summary-label">Aggregate</p>
          <p className="summary-value">{percentage}%</p>
          <p className="summary-note">
            {percentage >= 75 ? "On track for minimum criteria" : 'Attendance needs improvement'}
          </p>
        </article>

        <article className="card summary-mini">
          <p className="summary-label">Total</p>
          <p className="summary-count">{present}/{total}</p>
          <p className="summary-note">Marked present / total classes</p>
        </article>
      </section>

      <div className="student-actions-grid">
        <div className="card action-card">
          <h2>Biometric Setup</h2>
          {hasBiometric ? (
            <p className="text-dim text-sm mt-1">Biometric is active on this account.</p>
          ) : (
            <>
              <p className="text-dim text-sm mt-1">
                Set up fingerprint or Face ID once before marking attendance.
              </p>
              {biometricReady === false && (
                <p className="text-dim text-sm mt-1">
                  Open this app in Safari on iPhone or Chrome on Android over HTTPS, with
                  fingerprint or Face ID enabled.
                </p>
              )}
              <button
                type="button"
                className="btn btn-outline mt-1"
                onClick={registerBiometric}
                disabled={biometricBusy || biometricReady !== true}
              >
                {biometricBusy ? 'Setting up...' : 'Set Up Biometrics'}
              </button>
            </>
          )}
        </div>

        <div className="card action-card">
          <h2>Mark Attendance</h2>
          <form onSubmit={submitAttendance} className="mt-2">
            <div className="form-group">
              <label htmlFor="token-input">Enter 4-digit token (from teacher)</label>
              <input
                id="token-input"
                type="text"
                className="form-input student-token-input"
                placeholder="e.g. A3F2"
                value={token}
                onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 4))}
                maxLength={4}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || token.length !== 4 || !hasBiometric || biometricReady !== true}
            >
              {loading ? 'Submitting...' : 'Verify Biometrics & Submit'}
            </button>
          </form>
        </div>
      </div>

      {subjectMap.size > 0 && (
        <section className="student-subjects mt-2">
          <div className="student-section-head">
            <h2>Course Breakdown</h2>
            <p className="text-dim text-sm">Live overview</p>
          </div>

          <div className="subject-list">
            {Array.from(subjectMap.entries()).map(([subject, stats]) => {
              const pct = Math.round((stats.present / stats.total) * 100);
              const low = pct < 75;
              return (
                <article key={subject} className="subject-item">
                  <div className={`subject-chip ${low ? 'subject-chip-low' : ''}`}>{pct}%</div>
                  <p className="subject-code">{subject.slice(0, 6).toUpperCase()}</p>
                  <h3>{subject}</h3>
                  <div className="subject-meta-row">
                    <span>Attended: {stats.present}/{stats.total} classes</span>
                    <span>{low ? 'Low Attendance' : 'Good Standing'}</span>
                  </div>
                  <div className="subject-track">
                    <div
                      className={`subject-track-fill ${low ? 'subject-track-fill-low' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="card student-policy mt-2">
        <h2>Attendance Policy</h2>
        <p>Maintain at least 75% attendance per subject to qualify for final examinations.</p>
      </section>

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
        </>
      )}

      {activeTab === 'leaderboard' && (
        <section className="card student-leaderboard mt-2">
          <div className="student-section-head">
            <h2>Leaderboard</h2>
            <button className="btn btn-outline btn-sm" onClick={loadLeaderboard} type="button">
              Refresh
            </button>
          </div>

          {leaderboardLoading ? (
            <p className="text-dim text-sm mt-1">Loading leaderboard...</p>
          ) : leaderboard.length === 0 ? (
            <p className="text-dim text-sm mt-1">No leaderboard data available yet.</p>
          ) : (
            <div className="leaderboard-list mt-1">
              {leaderboard.map((entry, index) => (
                <article key={entry.student_id} className="leaderboard-item">
                  <div className="leaderboard-rank">#{index + 1}</div>
                  <img
                    src={entry.photo_path || DEFAULT_AVATARS[index % DEFAULT_AVATARS.length]}
                    alt={entry.full_name}
                    className="leaderboard-avatar"
                  />
                  <div className="leaderboard-main">
                    <h3>{entry.full_name}</h3>
                    <p className="text-dim text-sm">
                      {entry.roll_number || 'No roll'} • {entry.present}/{entry.total} classes
                    </p>
                  </div>
                  <div className={`leaderboard-score ${entry.percentage < 75 ? 'low' : ''}`}>
                    {entry.percentage}%
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'profile' && (
        <section className="card student-profile-panel mt-2">
          <h2>Profile Image</h2>
          <p className="text-dim text-sm mt-1">Choose an avatar or pick one from your gallery.</p>

          <div className="student-profile-preview-wrap">
            <img src={profileImage} alt="Selected profile" className="student-profile-preview" />
            <p className="text-sm mt-1">{profile?.full_name || 'Student'}</p>
          </div>

          <div className="student-avatar-grid mt-2">
            {DEFAULT_AVATARS.map((avatar) => (
              <button
                key={avatar}
                type="button"
                className={`student-avatar-option ${profileImage === avatar ? 'active' : ''}`}
                onClick={() => saveProfileImage(avatar)}
              >
                <img src={avatar} alt="Avatar option" />
              </button>
            ))}
          </div>

          <div className="mt-2">
            <label htmlFor="gallery-avatar" className="btn btn-outline">
              Choose From Gallery
            </label>
            <input
              id="gallery-avatar"
              type="file"
              accept="image/*"
              onChange={onGalleryPick}
              className="student-gallery-input"
            />
          </div>
        </section>
      )}
    </div>
  );
}
