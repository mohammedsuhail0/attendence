'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  calculateAttendancePercentage,
  formatDisplayDate,
  getMonthKeyInTimeZone,
} from '@/lib/utils';

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

const STUDENT_CACHE_VERSION = 'v1';
const STUDENT_LEADERBOARD_SCOPE = 'monthly';
type AuthRequestOptions = Parameters<typeof startAuthentication>[0];

function studentCacheKey(userId: string, key: 'history' | 'leaderboard-monthly') {
  return `student-dashboard-${STUDENT_CACHE_VERSION}-${userId}-${key}`;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function monthLabel(monthValue: string): string {
  const [year, month] = monthValue.split('-');
  const monthIndex = Number(month) - 1;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return monthValue;
  return `${monthNames[monthIndex]} ${year}`;
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
  const [historyMonthFilter, setHistoryMonthFilter] = useState('all');
  const [historyDateFilter, setHistoryDateFilter] = useState('all');
  const leaderboardInFlightRef = useRef(false);
  const historyInFlightRef = useRef(false);
  const lastBackgroundRefreshAtRef = useRef(0);
  const authOptionsCacheRef = useRef<{ options: AuthRequestOptions; fetchedAt: number } | null>(null);
  const authOptionsInFlightRef = useRef<Promise<AuthRequestOptions> | null>(null);

  async function loadLeaderboard(
    userIdForCache?: string,
    options?: { silent?: boolean }
  ) {
    if (leaderboardInFlightRef.current) return;
    leaderboardInFlightRef.current = true;
    if (!options?.silent) setLeaderboardLoading(true);
    try {
      const res = await fetch(`/api/attendance/leaderboard?scope=${STUDENT_LEADERBOARD_SCOPE}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load leaderboard');
      const nextLeaderboard = (data.leaderboard || []) as LeaderboardEntry[];
      setLeaderboard(nextLeaderboard);
      const cacheUserId = userIdForCache || currentUserId;
      if (cacheUserId) {
        window.sessionStorage.setItem(
          studentCacheKey(cacheUserId, 'leaderboard-monthly'),
          JSON.stringify(nextLeaderboard)
        );
      }
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to load leaderboard'));
    } finally {
      if (!options?.silent) setLeaderboardLoading(false);
      leaderboardInFlightRef.current = false;
    }
  }

  async function loadHistory(userIdForCache?: string) {
    if (historyInFlightRef.current) return;
    historyInFlightRef.current = true;
    try {
      const res = await fetch('/api/attendance/history', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load attendance history');
      const nextRecords = (data.records || []) as AttendanceRecord[];
      setRecords(nextRecords);
      const cacheUserId = userIdForCache || currentUserId;
      if (cacheUserId) {
        window.sessionStorage.setItem(
          studentCacheKey(cacheUserId, 'history'),
          JSON.stringify(nextRecords)
        );
      }
    } finally {
      historyInFlightRef.current = false;
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const cachedHistory = safeParseJson<AttendanceRecord[]>(
        window.sessionStorage.getItem(studentCacheKey(user.id, 'history'))
      );
      if (cachedHistory) {
        setRecords(cachedHistory);
      }

      const cachedLeaderboard = safeParseJson<LeaderboardEntry[]>(
        window.sessionStorage.getItem(studentCacheKey(user.id, 'leaderboard-monthly'))
      );
      if (cachedLeaderboard) {
        setLeaderboard(cachedLeaderboard);
        setLeaderboardLoading(false);
      }

      const profilePromise = supabase
        .from('profiles')
        .select('full_name, roll_number, photo_path, webauthn_credential')
        .eq('id', user.id)
        .single();

      await Promise.allSettled([loadHistory(user.id), loadLeaderboard(user.id)]);

      const { data: p } = await profilePromise;
      setProfile(p);
      setHasBiometric(Boolean(p?.webauthn_credential));

      const localAvatar = window.localStorage.getItem(`student-avatar-${user.id}`);
      setProfileImage(localAvatar || p?.photo_path || DEFAULT_AVATARS[0]);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const triggerBackgroundRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastBackgroundRefreshAtRef.current < 15000) return;
      lastBackgroundRefreshAtRef.current = now;
      void loadHistory();
      void loadLeaderboard(undefined, { silent: true });
    };

    const intervalId = window.setInterval(() => {
      triggerBackgroundRefresh();
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refreshNow = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastBackgroundRefreshAtRef.current < 15000) return;
      lastBackgroundRefreshAtRef.current = now;
      void loadHistory();
      void loadLeaderboard(undefined, { silent: true });
    };

    window.addEventListener('focus', refreshNow);
    document.addEventListener('visibilitychange', refreshNow);

    return () => {
      window.removeEventListener('focus', refreshNow);
      document.removeEventListener('visibilitychange', refreshNow);
    };
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

    const maxOptionsAgeMs = 30_000;
    const cachedOptions = authOptionsCacheRef.current;
    const now = Date.now();
    const isCacheFresh =
      cachedOptions && now - cachedOptions.fetchedAt <= maxOptionsAgeMs;

    if (isCacheFresh) {
      return startAuthentication(cachedOptions.options);
    }

    const options = await fetchAuthenticationOptions();
    return startAuthentication(options);
  }

  async function fetchAuthenticationOptions(force = false): Promise<AuthRequestOptions> {
    const maxOptionsAgeMs = 30_000;
    const cachedOptions = authOptionsCacheRef.current;
    const now = Date.now();
    const isCacheFresh =
      cachedOptions && now - cachedOptions.fetchedAt <= maxOptionsAgeMs;

    if (!force && isCacheFresh) {
      return cachedOptions.options;
    }

    if (!force && authOptionsInFlightRef.current) {
      return authOptionsInFlightRef.current;
    }

    const requestPromise = (async () => {
      const optionsRes = await fetch('/api/webauthn/authenticate/options', {
        method: 'POST',
      });
      const optionsData = await optionsRes.json();

      if (!optionsRes.ok) {
        throw new Error(optionsData.error || 'Unable to start biometric verification.');
      }

      authOptionsCacheRef.current = {
        options: optionsData.options,
        fetchedAt: Date.now(),
      };

      return optionsData.options as AuthRequestOptions;
    })();

    authOptionsInFlightRef.current = requestPromise;

    try {
      return await requestPromise;
    } finally {
      authOptionsInFlightRef.current = null;
    }
  }

  useEffect(() => {
    if (!hasBiometric || biometricReady !== true) return;
    if (token.length !== 4) return;
    void fetchAuthenticationOptions();
  }, [hasBiometric, biometricReady, token]);

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
      authOptionsCacheRef.current = null;

      await loadHistory();

      await loadLeaderboard();
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to submit attendance.'));
    } finally {
      setLoading(false);
    }
  }

  // Stats (monthly to match race leaderboard)
  const currentLeaderboardEntry = useMemo(
    () => leaderboard.find((entry) => entry.student_id === currentUserId),
    [leaderboard, currentUserId]
  );
  const currentMonthKey = useMemo(() => {
    return getMonthKeyInTimeZone(new Date(), 'Asia/Kolkata');
  }, []);
  const monthlyRecords = useMemo(
    () =>
      records.filter((record) =>
        (record.attendance_sessions?.session_date || '').startsWith(currentMonthKey)
      ),
    [records, currentMonthKey]
  );
  const monthlyTotal = monthlyRecords.length;
  const monthlyPresent = monthlyRecords.filter((r) => r.status === 'present').length;
  const monthlyPercentage = calculateAttendancePercentage(monthlyPresent, monthlyTotal);

  const syncedLeaderboard = useMemo(() => {
    if (!currentUserId) return leaderboard;

    let found = false;
    const next = leaderboard.map((entry) => {
      if (entry.student_id !== currentUserId) return entry;
      found = true;
      return {
        ...entry,
        total: monthlyTotal,
        present: monthlyPresent,
        percentage: monthlyPercentage,
      };
    });

    if (found || !profile) return next;

    return [
      {
        student_id: currentUserId,
        full_name: profile.full_name || 'You',
        roll_number: profile.roll_number,
        photo_path: profile.photo_path || null,
        total: monthlyTotal,
        present: monthlyPresent,
        percentage: monthlyPercentage,
      },
      ...next,
    ];
  }, [leaderboard, currentUserId, monthlyTotal, monthlyPresent, monthlyPercentage, profile]);

  const currentSyncedLeaderboardEntry = useMemo(
    () => syncedLeaderboard.find((entry) => entry.student_id === currentUserId),
    [syncedLeaderboard, currentUserId]
  );
  const total = currentSyncedLeaderboardEntry?.total ?? monthlyTotal;
  const present = currentSyncedLeaderboardEntry?.present ?? monthlyPresent;
  const percentage = currentSyncedLeaderboardEntry?.percentage ?? monthlyPercentage;

  // Subject-wise stats
  const subjectMap = new Map<string, { total: number; present: number }>();
  for (const r of records) {
    const subject = r.attendance_sessions?.classes?.subject || '-';
    const entry = subjectMap.get(subject) || { total: 0, present: 0 };
    entry.total++;
    if (r.status === 'present') entry.present++;
    subjectMap.set(subject, entry);
  }

  const historyMonthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const record of records) {
      const date = record.attendance_sessions?.session_date;
      if (date && date.length >= 7) months.add(date.slice(0, 7));
    }
    return Array.from(months).sort((left, right) => right.localeCompare(left));
  }, [records]);

  const historyDateOptions = useMemo(() => {
    const dates = new Set<string>();
    for (const record of records) {
      const date = record.attendance_sessions?.session_date;
      if (!date) continue;
      if (historyMonthFilter !== 'all' && !date.startsWith(historyMonthFilter)) continue;
      dates.add(date);
    }
    return Array.from(dates).sort((left, right) => right.localeCompare(left));
  }, [records, historyMonthFilter]);

  useEffect(() => {
    setHistoryDateFilter('all');
  }, [historyMonthFilter]);

  const filteredHistoryRecords = useMemo(() => {
    return records
      .filter((record) => {
        const date = record.attendance_sessions?.session_date || '';
        if (historyMonthFilter !== 'all' && !date.startsWith(historyMonthFilter)) return false;
        if (historyDateFilter !== 'all' && date !== historyDateFilter) return false;
        return true;
      })
      .sort((left, right) => {
        const leftDate = left.attendance_sessions?.session_date || '';
        const rightDate = right.attendance_sessions?.session_date || '';
        const dateCompare = rightDate.localeCompare(leftDate);
        if (dateCompare !== 0) return dateCompare;
        return (left.attendance_sessions?.period || 0) - (right.attendance_sessions?.period || 0);
      });
  }, [records, historyMonthFilter, historyDateFilter]);

  const groupedHistoryRecords = useMemo(() => {
    const groups = new Map<string, AttendanceRecord[]>();
    for (const record of filteredHistoryRecords) {
      const date = record.attendance_sessions?.session_date || 'unknown';
      const existing = groups.get(date) || [];
      existing.push(record);
      groups.set(date, existing);
    }
    return Array.from(groups.entries()).sort((left, right) => right[0].localeCompare(left[0]));
  }, [filteredHistoryRecords]);

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
          <Image
            src={profileImage}
            alt="Profile"
            className="student-app-avatar"
            width={40}
            height={40}
            unoptimized
          />
          <span>{profile?.full_name || 'Student'}</span>
        </div>
        <button className="student-app-gear" onClick={handleLogout} title="Sign Out" type="button">
          Settings
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {activeTab === 'dashboard' && (
        <>
          <section className="student-status-strip">
            <div className="student-status-icon">Live</div>
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
                    {token[index] || '*'}
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
              <p>This Month Attendance ({monthLabel(currentMonthKey)})</p>
            </article>
            <article className="student-kpi-card dark">
              <strong>{percentage >= 75 ? 'Good Standing' : 'Low Attendance'}</strong>
              <p>{percentage >= 75 ? 'Monthly Target Met' : 'Monthly Target Missed'}</p>
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
            <h2>Race to #1 (This Month)</h2>
            <p className="student-race-copy">Beat the class average and climb the rank table.</p>
            <button className="btn btn-outline btn-sm" onClick={() => void loadLeaderboard()} type="button">
              Refresh
            </button>
          </div>
          {leaderboardLoading ? (
            <p className="text-dim text-sm mt-1">Loading leaderboard...</p>
          ) : (
            <div className="leaderboard-list mt-1">
              {syncedLeaderboard.map((entry, index) => (
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
            <>
              <div className="history-filters mt-1">
                <div className="history-filter-grid">
                  <div className="form-group">
                    <label htmlFor="student-history-month">Month</label>
                    <select
                      id="student-history-month"
                      className="form-select"
                      value={historyMonthFilter}
                      onChange={(e) => setHistoryMonthFilter(e.target.value)}
                    >
                      <option value="all">All Months</option>
                      {historyMonthOptions.map((month) => (
                        <option key={month} value={month}>{monthLabel(month)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="student-history-date">Date</label>
                    <select
                      id="student-history-date"
                      className="form-select"
                      value={historyDateFilter}
                      onChange={(e) => setHistoryDateFilter(e.target.value)}
                    >
                      <option value="all">All Dates</option>
                      {historyDateOptions.map((date) => (
                        <option key={date} value={date}>{formatDisplayDate(date)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {groupedHistoryRecords.length === 0 ? (
                <p className="text-dim text-sm">No sessions found for selected filters.</p>
              ) : (
                <div className="history-date-groups">
                  {groupedHistoryRecords.map(([date, items], index) => (
                    <details className="history-date-group" key={date} open={index === 0}>
                      <summary className="history-date-summary">
                        <span>{formatDisplayDate(date)}</span>
                        <span className="history-date-count">{items.length} classes</span>
                      </summary>
                      <div className="history-date-content">
                        {items.map((item) => (
                          <article className="history-entry" key={item.id}>
                            <div className="history-entry-top">
                              <h4>{item.attendance_sessions?.classes?.subject || '-'}</h4>
                              <span className="history-period-chip">P{item.attendance_sessions?.period || '-'}</span>
                            </div>
                            <div className="history-entry-bottom">
                              <span className={`badge badge-${item.status}`}>{item.status}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'profile' && (
        <section className="card student-profile-panel mt-2">
          <h2>Profile Image</h2>
          <p className="text-dim text-sm mt-1">Choose an avatar or pick one from your gallery.</p>
          <div className="student-profile-preview-wrap">
            <Image
              src={profileImage}
              alt="Selected profile"
              className="student-profile-preview"
              width={96}
              height={96}
              unoptimized
            />
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
                <Image src={avatar} alt="Avatar option" width={48} height={48} unoptimized />
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

