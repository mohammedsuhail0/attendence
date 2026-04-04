'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { formatDisplayDate } from '@/lib/utils';

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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'subjects' | 'history' | 'profile'>('dashboard');
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

  const sortedHistoryRecords = useMemo(() => {
    const copy = [...records];
    copy.sort((left, right) => {
      const leftSubject = left.attendance_sessions?.classes?.subject || '';
      const rightSubject = right.attendance_sessions?.classes?.subject || '';
      const subjectCompare = leftSubject.localeCompare(rightSubject);
      if (subjectCompare !== 0) return subjectCompare;

      const leftDate = left.attendance_sessions?.session_date || '';
      const rightDate = right.attendance_sessions?.session_date || '';
      const dateCompare = rightDate.localeCompare(leftDate);
      if (dateCompare !== 0) return dateCompare;

      return (left.attendance_sessions?.period || 0) - (right.attendance_sessions?.period || 0);
    });
    return copy;
  }, [records]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function saveProfileImage(imageUrl: string) {
    setProfileImage(imageUrl);
    setProfile((prev) => (prev ? { ...prev, photo_path: imageUrl } : prev));
    setLeaderboard((prev) =>
      prev.map((entry) =>
        entry.student_id === currentUserId
          ? { ...entry, photo_path: imageUrl }
          : entry
      )
    );

    if (currentUserId) {
      window.localStorage.setItem(`student-avatar-${currentUserId}`, imageUrl);
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ photo_path: imageUrl })
      .eq('id', currentUserId);

    if (updateError) {
      setError('Profile image changed locally, but sync failed. Please try again.');
      return;
    }

    await loadLeaderboard();
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
      void saveProfileImage(value);
    };
    reader.onerror = () => {
      setError('Unable to read selected image.');
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="page student-app-shell">
      <div className="student-app-header">
        <div className="student-app-brand">
          <img src={profileImage} alt="Profile" className="student-app-avatar" />
          <span>{profile?.full_name || 'Student'}</span>
        </div>
        <button className="student-app-gear" onClick={handleLogout} title="Sign Out" type="button">
          ⚙
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {activeTab === 'dashboard' && (
        <>
          <section className="student-status-strip">
            <div className="student-status-icon">◍</div>
            <div>
              <h3>Biometric Status</h3>
              <p>{hasBiometric ? 'Biometric is active' : 'Biometric setup required'}</p>
            </div>
            <span className={`student-status-dot ${hasBiometric ? 'on' : 'off'}`} />
          </section>

          {!hasBiometric && (
            <button
              type="button"
              className="btn btn-outline btn-block mt-1"
              onClick={registerBiometric}
              disabled={biometricBusy || biometricReady !== true}
            >
              {biometricBusy ? 'Setting up...' : 'Set Up Biometrics'}
            </button>
          )}

          <section className="student-attendance-hero mt-2">
            <h2>Mark Attendance</h2>
            <p>Enter the 4-digit token provided by your professor</p>
            <form onSubmit={submitAttendance}>
              <label htmlFor="token-input" className="student-token-grid" aria-label="4 digit token">
                {[0, 1, 2, 3].map((index) => (
                  <span key={index} className="student-token-box">
                    {token[index] || '•'}
                  </span>
                ))}
                <input
                  id="token-input"
                  type="text"
                  className="student-token-hidden-input"
                  placeholder="A3F2"
                  value={token}
                  onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 4))}
                  maxLength={4}
                  required
                />
              </label>

              <button
                type="submit"
                className="btn btn-primary btn-block student-submit-btn"
                disabled={loading || token.length !== 4 || !hasBiometric || biometricReady !== true}
              >
                {loading ? 'Submitting...' : 'Verify & Submit'}
              </button>
            </form>
          </section>

          <section className="student-kpi-grid mt-2">
            <article className="student-kpi-card light">
              <strong>{percentage}%</strong>
              <p>Overall Attendance</p>
            </article>
            <article className="student-kpi-card dark">
              <strong>{percentage >= 75 ? 'Good Standing' : 'Low Attendance'}</strong>
              <p>{percentage >= 75 ? 'Above Requirement' : 'Below Requirement'}</p>
            </article>
          </section>

          <section className="student-section mt-2">
            <div className="student-section-headline">
              <h2>Subject Performance</h2>
            </div>
            <div className="student-performance-card">
              {Array.from(subjectMap.entries()).map(([subject, stats]) => {
                const pct = Math.round((stats.present / stats.total) * 100);
                return (
                  <div key={subject} className="student-performance-row">
                    <div>
                      <h3>{subject}</h3>
                      <p>{stats.present} / {stats.total} Classes</p>
                    </div>
                    <span className={`student-performance-chip ${pct < 75 ? 'low' : ''}`}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="student-section mt-2">
            <div className="student-section-headline">
              <h2>Recent Logs</h2>
            </div>
            <div className="student-log-list">
              {records.slice(0, 3).map((record) => (
                <article key={record.id} className="student-log-item">
                  <div className="student-log-date">{formatDisplayDate(record.attendance_sessions?.session_date || '-')}</div>
                  <div className="student-log-main">
                    <h3>{record.attendance_sessions?.classes?.subject || '-'}</h3>
                    <p>Period {record.attendance_sessions?.period || '-'}</p>
                  </div>
                  <span className={`student-log-status ${record.status === 'present' ? 'present' : 'absent'}`}>
                    {record.status.toUpperCase()}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {activeTab === 'subjects' && (
        <section className="card student-leaderboard mt-2">
          <div className="student-section-headline">
            <h2>Race to #1</h2>
            <p className="student-race-copy">Beat the class average and climb the rank table.</p>
            <button className="btn btn-outline btn-sm" onClick={loadLeaderboard} type="button">
              Refresh
            </button>
          </div>
          {leaderboardLoading ? (
            <p className="text-dim text-sm mt-1">Loading leaderboard...</p>
          ) : (
            <div className="leaderboard-list mt-1">
              {leaderboard.map((entry, index) => (
                <article key={entry.student_id} className="leaderboard-item">
                  <div className="leaderboard-rank">#{index + 1}</div>
                  <div className="leaderboard-main">
                    <h3>{entry.full_name}</h3>
                    <p className="text-dim text-sm">{entry.roll_number || 'No roll number'}</p>
                  </div>
                  <div className={`leaderboard-score ${entry.percentage < 75 ? 'low' : ''}`}>{entry.percentage}%</div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'history' && (
        <section className="card mt-2">
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
                  {sortedHistoryRecords.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDisplayDate(r.attendance_sessions?.session_date || '-')}</td>
                      <td>{r.attendance_sessions?.classes?.subject || '-'}</td>
                      <td>P{r.attendance_sessions?.period}</td>
                      <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                onClick={() => void saveProfileImage(avatar)}
              >
                <img src={avatar} alt="Avatar option" />
              </button>
            ))}
          </div>
          <div className="mt-2">
            <label htmlFor="gallery-avatar" className="btn btn-outline">Choose From Gallery</label>
            <input id="gallery-avatar" type="file" accept="image/*" onChange={onGalleryPick} className="student-gallery-input" />
          </div>
        </section>
      )}

      <nav className="student-bottom-nav" aria-label="Student navigation">
        <button type="button" className={`student-bottom-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>Dashboard</button>
        <button type="button" className={`student-bottom-item ${activeTab === 'subjects' ? 'active' : ''}`} onClick={() => setActiveTab('subjects')}>Race</button>
        <button type="button" className={`student-bottom-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>History</button>
        <button type="button" className={`student-bottom-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>Profile</button>
      </nav>
    </div>
  );
}
