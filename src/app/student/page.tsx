'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  getMonthKeyInTimeZone,
} from '@/lib/utils';

interface AttendanceRecord {
  id: string;
  status: string;
  mark_mode?: string;
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
const ATTENDANCE_SUBMIT_MAX_ATTEMPTS = 3;
const ATTENDANCE_SUBMIT_TIMEOUT_MS = 9_000;
const RETRYABLE_ATTENDANCE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
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

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
  const [activeTab, setActiveTab] = useState<'checkin' | 'analytics' | 'leaderboard' | 'profile'>('checkin');
  const [profileImage, setProfileImage] = useState<string>(DEFAULT_AVATARS[0]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [qrTokenScanned, setQrTokenScanned] = useState(false);

  const leaderboardInFlightRef = useRef(false);
  const historyInFlightRef = useRef(false);
  const lastBackgroundRefreshAtRef = useRef(0);
  const authOptionsCacheRef = useRef<{ options: AuthRequestOptions; fetchedAt: number } | null>(null);
  const authOptionsInFlightRef = useRef<Promise<AuthRequestOptions> | null>(null);

  // Auto-detect ?token=... from QR code scan
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tokenParam = params.get('token');
      if (tokenParam && tokenParam.length === 4) {
        setToken(tokenParam.toUpperCase());
        setQrTokenScanned(true);
        setSuccess('QR Code verified! Token loaded. Tap below to authenticate.');
      }
    }
  }, []);

  const loadLeaderboard = useCallback(async (
    userIdForCache?: string,
    options?: { silent?: boolean }
  ) => {
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
  }, [currentUserId]);

  const loadHistory = useCallback(async (userIdForCache?: string) => {
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
  }, [currentUserId]);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
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
  }, [supabase, router, loadHistory, loadLeaderboard]);

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
      setSuccess('Biometric passkey registered successfully! You can now mark attendance.');
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to set up biometrics.'));
    } finally {
      setBiometricBusy(false);
    }
  }

  async function fetchAuthenticationOptions(force = false): Promise<AuthRequestOptions> {
    const maxOptionsAgeMs = 25_000;
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

  async function createBiometricAssertion(): Promise<unknown> {
    if (!browserSupportsWebAuthn()) {
      throw new Error('This browser does not support phone biometrics.');
    }
    requireBiometricSupport();

    const maxOptionsAgeMs = 25_000;
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

  async function submitAttendanceRequest(payload: { token: string; assertion: unknown }) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ATTENDANCE_SUBMIT_TIMEOUT_MS);

    try {
      const res = await fetch('/api/attendance/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      return { res, data };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function submitAttendanceWithRetry(payload: { token: string; assertion: unknown }) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ATTENDANCE_SUBMIT_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await submitAttendanceRequest(payload);
        const shouldRetry =
          !result.res.ok &&
          RETRYABLE_ATTENDANCE_STATUS_CODES.has(result.res.status) &&
          attempt < ATTENDANCE_SUBMIT_MAX_ATTEMPTS;

        if (shouldRetry) {
          await sleep(150 * attempt);
          continue;
        }

        return result;
      } catch (error: unknown) {
        const isAbortError = error instanceof DOMException && error.name === 'AbortError';
        const isNetworkError = error instanceof TypeError || isAbortError;
        lastError = isAbortError
          ? new Error('Network is slow right now. Please try once more.')
          : error;

        if (isNetworkError && attempt < ATTENDANCE_SUBMIT_MAX_ATTEMPTS) {
          await sleep(150 * attempt);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Failed to submit attendance.');
  }

  async function submitAttendance(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!hasBiometric) {
        throw new Error('Please set up your biometric passkey first.');
      }

      const assertion = await createBiometricAssertion();
      const tokenValue = token.toUpperCase().trim();
      const { res, data } = await submitAttendanceWithRetry({
        token: tokenValue,
        assertion,
      });

      const errorMessage =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: unknown }).error || '')
          : '';
      if (!res.ok) {
        throw new Error(errorMessage || 'Failed to submit attendance.');
      }

      setSuccess('🎉 Attendance marked successfully! Verified with biometric passkey.');
      setToken('');
      setQrTokenScanned(false);
      authOptionsCacheRef.current = null;
      void Promise.allSettled([loadHistory(), loadLeaderboard()]);
    } catch (e: unknown) {
      setError(toErrorMessage(e, 'Failed to submit attendance.'));
    } finally {
      setLoading(false);
    }
  }

  // Monthly stats calculations
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

  // Synced leaderboard
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

  const userRankIndex = useMemo(() => {
    const sorted = [...syncedLeaderboard].sort((a, b) => b.percentage - a.percentage || b.present - a.present);
    return sorted.findIndex((s) => s.student_id === currentUserId) + 1;
  }, [syncedLeaderboard, currentUserId]);

  // Subject-wise stats
  const subjectMap = useMemo(() => {
    const map = new Map<string, { total: number; present: number }>();
    for (const r of records) {
      const subject = r.attendance_sessions?.classes?.subject || 'General';
      const entry = map.get(subject) || { total: 0, present: 0 };
      entry.total++;
      if (r.status === 'present') entry.present++;
      map.set(subject, entry);
    }
    return map;
  }, [records]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const [expandedStudentDates, setExpandedStudentDates] = useState<Record<string, boolean>>({});

  function toggleStudentDate(dateKey: string) {
    setExpandedStudentDates((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  }

  // Group attendance records by date
  const recordsByDate = useMemo(() => {
    const map = new Map<string, typeof records>();
    for (const r of records) {
      const d = r.attendance_sessions?.session_date || 'Undated';
      const list = map.get(d) || [];
      list.push(r);
      map.set(d, list);
    }
    return Array.from(map.entries()).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [records]);

  return (
    <div className="mobile-app-shell">
      {/* Top Mobile Header */}
      <header className="mobile-app-header">
        <div className="flex items-center gap-1">
          <Image
            src={profileImage}
            alt="Profile Avatar"
            width={36}
            height={36}
            className="roster-avatar"
            unoptimized
          />
          <div className="brand-header-wrap">
            <h1>{profile?.full_name || 'Student Portal'}</h1>
            <span className="user-info">
              {profile?.roll_number ? `Roll ${profile.roll_number}` : 'Enrolled'} • {monthLabel(currentMonthKey)}
            </span>
          </div>
        </div>

        <span className={`badge ${hasBiometric ? 'badge-present' : 'badge-absent'}`}>
          {hasBiometric ? 'PASSKEY' : 'NO PASSKEY'}
        </span>
      </header>

      {/* Main Content Area */}
      <main className={`mobile-app-content ${activeTab === 'checkin' ? 'fit-screen' : ''}`}>
        {/* Banner Alerts */}
        {error && <div className="alert alert-error">⚠️ {error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* TAB 1: CHECK-IN (FIT SCREEN, ZERO SCROLL) */}
        {activeTab === 'checkin' && (
          <div className="flex-col justify-between" style={{ height: '100%', gap: '0.65rem' }}>
            <div className="flex-col gap-1">
              {/* Biometric Status Notification */}
              {!hasBiometric && (
                <div className="card" style={{ marginBottom: '0.25rem', padding: '0.85rem' }}>
                  <div className="flex-between">
                    <div>
                      <h3 style={{ fontSize: '0.95rem' }}>Biometric Passkey Required</h3>
                      <p className="card-meta">Enable Face ID / Fingerprint to check in</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-block mt-1"
                    onClick={registerBiometric}
                    disabled={biometricBusy || biometricReady !== true}
                  >
                    {biometricBusy ? 'Setting up Passkey...' : 'Set Up Biometric Passkey'}
                  </button>
                </div>
              )}

              {/* Attendance Check-in Card */}
              <div className="card" style={{ marginBottom: '0.25rem' }}>
                <div className="card-header">
                  <h2>Mark Attendance</h2>
                  {qrTokenScanned && <span className="badge badge-present">QR Auto-Loaded</span>}
                </div>
                <p className="text-dim text-sm text-center">
                  {qrTokenScanned
                    ? 'PIN loaded from QR code. Tap verify to submit.'
                    : 'Enter the 4-digit PIN broadcasted by faculty.'}
                </p>

                <form onSubmit={submitAttendance}>
                  <label htmlFor="student-token-field" className="student-token-grid" style={{ margin: '1rem 0' }}>
                    {[0, 1, 2, 3].map((index) => (
                      <span
                        key={index}
                        className={`student-token-box ${token[index] ? 'active' : ''}`}
                      >
                        {token[index] || '•'}
                      </span>
                    ))}
                    <input
                      id="student-token-field"
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
                    className="btn btn-primary btn-block"
                    disabled={loading || token.length !== 4 || !hasBiometric || biometricReady !== true}
                  >
                    {loading ? 'Authenticating...' : 'Verify & Submit Attendance'}
                  </button>
                </form>
              </div>
            </div>

            {/* Monthly Attendance Quick Standing Card */}
            <button
              type="button"
              className="card flex-between"
              style={{ padding: '0.85rem 1rem', cursor: 'pointer', textAlign: 'left', background: 'var(--surface-2)' }}
              onClick={() => setActiveTab('analytics')}
            >
              <div>
                <div className="text-dim text-sm">Monthly Attendance Standing</div>
                <div className="font-bold" style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>
                  {monthlyPercentage}% • {monthlyPresent} of {monthlyTotal} classes
                </div>
              </div>
              <span className={`badge ${monthlyPercentage >= 75 ? 'badge-present' : 'badge-absent'}`}>
                {monthlyPercentage >= 75 ? 'Good' : 'At Risk'} →
              </span>
            </button>
          </div>
        )}

        {/* TAB 2: ANALYTICS & SUBJECTS */}
        {activeTab === 'analytics' && (
          <div className="flex-col gap-1">
            {/* KPI Overview */}
            <div className="student-kpi-grid">
              <div className="student-kpi-card">
                <strong>{monthlyPercentage}%</strong>
                <p>This Month ({monthLabel(currentMonthKey)})</p>
                <div className="progress-track">
                  <div
                    className={`progress-bar-fill ${monthlyPercentage < 75 ? 'danger' : ''}`}
                    style={{ width: `${monthlyPercentage}%` }}
                  ></div>
                </div>
              </div>

              <div className="student-kpi-card">
                <strong className={monthlyPercentage >= 75 ? 'text-emerald-700' : 'text-rose-700'}>
                  {monthlyPercentage >= 75 ? 'Good Standing' : 'Defaulter Risk'}
                </strong>
                <p>{monthlyPresent} of {monthlyTotal} classes attended</p>
              </div>
            </div>

            {/* Subject Breakdown Card */}
            <div className="card">
              <div className="card-header">
                <h2>Subject Performance</h2>
                <span className="badge badge-active">{subjectMap.size} Subjects</span>
              </div>

              <div className="flex-col">
                {Array.from(subjectMap.entries()).map(([subject, stats]) => {
                  const pct = Math.round((stats.present / stats.total) * 100);
                  return (
                    <div key={subject} className="student-performance-row">
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="roster-name-text">{subject}</div>
                        <div className="text-dim text-sm">
                          {stats.present} / {stats.total} Classes
                        </div>
                        <div className="progress-track">
                          <div
                            className={`progress-bar-fill ${pct < 75 ? 'warning' : ''}`}
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                      <span className={`badge ${pct >= 75 ? 'badge-present' : 'badge-absent'}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
                {subjectMap.size === 0 && (
                  <p className="text-dim text-sm text-center py-3">No subjects recorded yet</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LEADERBOARD */}
        {activeTab === 'leaderboard' && (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="card-header">
              <h2>Leaderboard</h2>
              <span className="badge badge-present">Your Rank #{userRankIndex || '-'}</span>
            </div>

            <div className="roster-list" style={{ flex: 1, maxHeight: 'none' }}>
              {leaderboardLoading ? (
                <p className="text-dim text-sm text-center py-6">Loading leaderboard...</p>
              ) : (
                syncedLeaderboard.slice(0, 15).map((entry, idx) => {
                  const isMe = entry.student_id === currentUserId;
                  const rankIcon = idx === 0 ? '1' : idx === 1 ? '2' : idx === 2 ? '3' : `${idx + 1}`;
                  return (
                    <div
                      key={entry.student_id}
                      className="roster-row"
                      style={isMe ? { background: 'var(--surface-2)', borderColor: 'var(--primary)' } : {}}
                    >
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-sm" style={{ width: 24 }}>#{rankIcon}</span>
                        <div className="roster-name-col">
                          <div className="roster-name-text">
                            {entry.full_name} {isMe && '(You)'}
                          </div>
                          <div className="roster-roll-text">{entry.roll_number || 'Student'}</div>
                        </div>
                      </div>

                      <span className="font-mono font-bold text-sm">
                        {entry.percentage}%
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 4: PROFILE & DATE-GROUPED LOGS */}
        {activeTab === 'profile' && (
          <div className="flex-col gap-1">
            {/* Static Student Profile Card (No edit/change avatar) */}
            <div className="card">
              <div className="card-header">
                <h2>Student Profile</h2>
                <span className="badge badge-active">{profile?.roll_number ? `Roll ${profile.roll_number}` : 'Enrolled'}</span>
              </div>

              <div className="flex items-center gap-2 mb-2 p-3 rounded-2xl bg-[#faf6ee] border border-stone-200">
                <Image
                  src={profileImage}
                  alt="Student Avatar"
                  width={56}
                  height={56}
                  className="rounded-full bg-white border border-stone-300 object-cover"
                  unoptimized
                />
                <div>
                  <h3 className="text-base font-bold">{profile?.full_name || 'Student'}</h3>
                  <p className="text-dim text-sm">Roll No: {profile?.roll_number || 'N/A'}</p>
                  <p className="text-dim text-xs">Biometrics: {hasBiometric ? 'Passkey Enrolled' : 'Not Enrolled'}</p>
                </div>
              </div>

              <button
                onClick={registerBiometric}
                disabled={biometricBusy || biometricReady !== true}
                type="button"
                className="btn btn-secondary btn-block mb-1"
              >
                {biometricBusy ? 'Registering...' : 'Re-register Biometric Passkey'}
              </button>

              <button onClick={handleLogout} type="button" className="btn btn-danger btn-block">
                Sign Out
              </button>
            </div>

            {/* Date-Grouped Attendance Logs */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>Attendance History</h2>
                  <p className="card-meta">Grouped by Date • {records.length} classes recorded</p>
                </div>
                <span className="badge badge-closed">{recordsByDate.length} Days</span>
              </div>

              <div className="date-group-list" style={{ marginTop: '0.5rem' }}>
                {recordsByDate.map(([dateKey, dayRecords]) => {
                  const isExpanded = expandedStudentDates[dateKey] ?? true;
                  const presentDayCount = dayRecords.filter((r) => r.status === 'present').length;
                  return (
                    <div key={dateKey} className="date-group-card">
                      <div
                        className="date-group-header"
                        onClick={() => toggleStudentDate(dateKey)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="date-group-title">
                          <span>{dateKey}</span>
                          <span className="text-dim text-xs">
                            ({presentDayCount}/{dayRecords.length} present)
                          </span>
                        </div>
                        <span className="date-group-badge">
                          {isExpanded ? 'Hide ▲' : 'Show ▼'}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="date-group-content">
                          {dayRecords.map((r) => {
                            const isPresent = r.status === 'present';
                            return (
                              <div key={r.id} className="date-session-item">
                                <div className="date-session-meta">
                                  <div className="date-session-title">
                                    {r.attendance_sessions?.classes?.subject || 'Class'} • Period {r.attendance_sessions?.period}
                                  </div>
                                  <div className="date-session-sub">
                                    {r.verified_at ? new Date(r.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Attendance Logged'}
                                  </div>
                                </div>
                                <span className={`badge ${isPresent ? 'badge-present' : 'badge-absent'}`}>
                                  {isPresent ? '✓ Present' : 'Absent'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {recordsByDate.length === 0 && (
                  <p className="text-center text-dim py-6 text-sm">
                    No attendance records found yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Mobile Tab Bar (Clean Text Navigation) */}
      <nav className="mobile-bottom-nav">
        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'checkin' ? 'active' : ''}`}
          onClick={() => setActiveTab('checkin')}
        >
          <span>Check-In</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <span>Analytics</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'leaderboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('leaderboard')}
        >
          <span>Rankings</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span>Account</span>
        </button>
      </nav>
    </div>
  );
}
