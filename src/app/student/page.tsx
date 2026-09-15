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
  const [activeTab, setActiveTab] = useState<'checkin' | 'subjects' | 'leaderboard' | 'history' | 'profile'>('checkin');
  const [profileImage, setProfileImage] = useState<string>(DEFAULT_AVATARS[0]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [historyMonthFilter] = useState('all');
  const [historyDateFilter] = useState('all');
  const [qrTokenScanned, setQrTokenScanned] = useState(false);

  const leaderboardInFlightRef = useRef(false);
  const historyInFlightRef = useRef(false);
  const lastBackgroundRefreshAtRef = useRef(0);
  const authOptionsCacheRef = useRef<{ options: AuthRequestOptions; fetchedAt: number } | null>(null);
  const authOptionsInFlightRef = useRef<Promise<AuthRequestOptions> | null>(null);

  // Auto-detect ?token=... query parameter from QR code scan
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
        throw new Error('Please register your biometric passkey first.');
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

      setSuccess('Attendance marked successfully! Verified with biometric passkey.');
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

  // Filtered History
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
      setError('Profile image changed locally, but sync failed.');
      return;
    }

    await loadLeaderboard();
    setSuccess('Profile avatar updated.');
  }

  return (
    <div className="viewport-app">
      {/* Top Header Navigation */}
      <header className="viewport-header">
        <div className="header-brand">
          <div className="brand-badge">
            <span className="badge-dot pulse-emerald"></span>
            NOVA STUDENT
          </div>
          <div className="header-title-group">
            <h1>{profile?.full_name || 'Student Portal'}</h1>
            <span className="text-secondary text-xs">
              Roll No: {profile?.roll_number || 'Enrolled'} • {monthLabel(currentMonthKey)}
            </span>
          </div>
        </div>

        <div className="header-actions">
          {/* Biometric Status Chip */}
          <div className="session-status-pill active">
            <span className={`live-indicator ${hasBiometric ? '' : 'badge-absent'}`}></span>
            <span className="font-semibold text-xs text-slate-700">
              {hasBiometric ? 'Passkey Ready' : 'Setup Passkey'}
            </span>
          </div>

          <div className="header-divider"></div>

          {/* Tab Navigation */}
          <nav className="mode-toggle-pill">
            <button
              onClick={() => setActiveTab('checkin')}
              className={`toggle-tab ${activeTab === 'checkin' ? 'active' : ''}`}
            >
              🎯 Check-In
            </button>
            <button
              onClick={() => setActiveTab('subjects')}
              className={`toggle-tab ${activeTab === 'subjects' ? 'active' : ''}`}
            >
              📊 Subjects
            </button>
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`toggle-tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
            >
              🏆 Leaderboard
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`toggle-tab ${activeTab === 'history' ? 'active' : ''}`}
            >
              📜 History
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`toggle-tab ${activeTab === 'profile' ? 'active' : ''}`}
            >
              ⚙️ Profile
            </button>
          </nav>

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

        {/* TAB 1: CHECK-IN / DASHBOARD OVERVIEW */}
        {activeTab === 'checkin' && (
          <div className="viewport-grid grid-3col">
            {/* Bento Col 1: Fast Biometric Check-in */}
            <section className="bento-card col-controls">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Attendance Check-In</h2>
                  <p className="card-subtitle">
                    {qrTokenScanned ? '⚡ QR Code Auto-Detected' : 'Enter 4-digit code or scan QR'}
                  </p>
                </div>
                {qrTokenScanned && <span className="badge-present">QR Scanned</span>}
              </div>

              {!hasBiometric && (
                <div className="security-notice-box mb-3">
                  <div className="security-notice-header">
                    <span>⚠️ Passkey Registration Required</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    Pair your device Face ID / Fingerprint once to mark 1-tap attendance.
                  </p>
                  <button
                    onClick={registerBiometric}
                    disabled={biometricBusy || biometricReady !== true}
                    className="btn-primary w-full text-xs font-semibold py-2"
                  >
                    {biometricBusy ? 'Registering...' : '🔐 Setup Biometric Passkey'}
                  </button>
                </div>
              )}

              <form onSubmit={submitAttendance} className="control-form">
                <div className="form-group">
                  <label className="form-label text-center">Enter 4-Digit Classroom PIN</label>
                  <div className="token-input-boxes">
                    {[0, 1, 2, 3].map((index) => (
                      <span
                        key={index}
                        className={`token-digit-cell ${token[index] ? 'filled' : ''}`}
                      >
                        {token[index] || '•'}
                      </span>
                    ))}
                  </div>

                  <input
                    type="text"
                    className="token-hidden-real-input"
                    value={token}
                    onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 4))}
                    maxLength={4}
                    placeholder="Enter 4-digit PIN"
                    autoFocus
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || token.length !== 4 || !hasBiometric || biometricReady !== true}
                  className="btn-primary w-full py-3.5 text-sm font-bold shadow-md"
                >
                  {loading ? '🔐 Authenticating Passkey...' : '⚡ Verify & Mark Attendance'}
                </button>
              </form>

              <div className="quick-archive-section mt-auto">
                <div className="section-label">Device Security Health</div>
                <div className="text-xs text-slate-500 space-y-1">
                  <div className="flex justify-between">
                    <span>WebAuthn Ready:</span>
                    <span className="font-semibold text-emerald-600">{biometricReady ? 'Yes ✓' : 'Checking...'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Anti-Spoofing:</span>
                    <span className="font-semibold text-emerald-600">Hardware Level</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Bento Col 2: Attendance Standing & Metrics */}
            <section className="bento-card col-broadcast">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Monthly Standing</h2>
                  <p className="card-subtitle">{monthLabel(currentMonthKey)} Overview</p>
                </div>
                <span className={`badge-light font-bold ${monthlyPercentage >= 75 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>
                  {monthlyPercentage >= 75 ? '✓ Good Standing' : '⚠️ Defaulter Risk (<75%)'}
                </span>
              </div>

              <div className="broadcast-hero">
                {/* Big Metric Radial / Box */}
                <div className="attendance-metric-display">
                  <div className="attendance-percentage-huge font-mono">
                    {monthlyPercentage}
                    <span className="percentage-sign">%</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-500 mt-1">
                    {monthlyPresent} Present / {monthlyTotal} Total Lectures Recorded
                  </p>
                </div>

                {/* Subject Highlights Grid */}
                <div className="w-full mt-4">
                  <div className="section-label text-left mb-2">Subject Performance Summary</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from(subjectMap.entries()).slice(0, 4).map(([subj, st]) => {
                      const pct = Math.round((st.present / st.total) * 100);
                      return (
                        <div key={subj} className="subject-mini-card">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-xs text-slate-700 truncate">{subj}</span>
                            <span className={`text-xs font-bold ${pct >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {pct}%
                            </span>
                          </div>
                          <div className="progress-bar-container">
                            <div
                              className={`progress-bar-fill ${pct < 75 ? 'bg-amber-500' : ''}`}
                              style={{ width: `${pct}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {/* Bento Col 3: Race to #1 Leaderboard */}
            <section className="bento-card col-roster">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Race to #1 Podium</h2>
                  <p className="card-subtitle">Top attendance in your cohort</p>
                </div>
                <span className="badge-light">Rank #{userRankIndex || '-'}</span>
              </div>

              <div className="roster-list-container">
                {leaderboardLoading ? (
                  <p className="text-xs text-slate-400 p-4 text-center">Loading leaderboard...</p>
                ) : (
                  syncedLeaderboard.slice(0, 10).map((entry, idx) => {
                    const isMe = entry.student_id === currentUserId;
                    const rankMedal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                    return (
                      <div
                        key={entry.student_id}
                        className={`student-roster-row ${isMe ? 'row-highlighted-user' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="rank-badge-text font-bold text-xs">{rankMedal}</span>
                          <div className="student-meta">
                            <div className="student-name">
                              {entry.full_name} {isMe && '(You)'}
                            </div>
                            <div className="student-roll">{entry.roll_number || 'Student'}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-700">
                            {entry.percentage}%
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: SUBJECTS BREAKDOWN */}
        {activeTab === 'subjects' && (
          <div className="archive-view-container">
            <div className="bento-card archive-card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Subject Attendance Breakdown</h2>
                  <p className="card-subtitle">Detailed subject metrics and criteria</p>
                </div>
                <span className="badge-light">{subjectMap.size} Subjects</span>
              </div>

              <div className="archive-table-container">
                <table className="archive-table">
                  <thead>
                    <tr>
                      <th>Subject Name</th>
                      <th>Total Sessions</th>
                      <th>Attended</th>
                      <th>Missed</th>
                      <th>Percentage</th>
                      <th>Academic Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(subjectMap.entries()).map(([subj, stats]) => {
                      const pct = Math.round((stats.present / stats.total) * 100);
                      const missed = stats.total - stats.present;
                      return (
                        <tr key={subj}>
                          <td className="font-bold text-slate-800">{subj}</td>
                          <td>{stats.total}</td>
                          <td className="font-semibold text-emerald-600">{stats.present}</td>
                          <td className="text-rose-500">{missed}</td>
                          <td>
                            <span className={`font-bold font-mono ${pct >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {pct}%
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge-sm ${pct >= 75 ? 'badge-active' : 'badge-closed'}`}>
                              {pct >= 75 ? 'Eligible for Exams' : 'Attendance Shortage'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LEADERBOARD FULL VIEW */}
        {activeTab === 'leaderboard' && (
          <div className="archive-view-container">
            <div className="bento-card archive-card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Cohort Attendance Leaderboard</h2>
                  <p className="card-subtitle">Monthly rankings for {monthLabel(currentMonthKey)}</p>
                </div>
                <span className="badge-light">Your Rank: #{userRankIndex}</span>
              </div>

              <div className="archive-table-container">
                <table className="archive-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Student Name</th>
                      <th>Roll Number</th>
                      <th>Present Count</th>
                      <th>Total Sessions</th>
                      <th>Attendance Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncedLeaderboard.map((entry, idx) => {
                      const isMe = entry.student_id === currentUserId;
                      return (
                        <tr key={entry.student_id} className={isMe ? 'bg-indigo-50/60 font-semibold' : ''}>
                          <td>
                            {idx === 0 ? '🥇 1st' : idx === 1 ? '🥈 2nd' : idx === 2 ? '🥉 3rd' : `#${idx + 1}`}
                          </td>
                          <td className="font-semibold text-slate-800">
                            {entry.full_name} {isMe && <span className="badge-present text-[10px] ml-1">YOU</span>}
                          </td>
                          <td className="font-mono text-xs">{entry.roll_number || '-'}</td>
                          <td className="text-emerald-600 font-semibold">{entry.present}</td>
                          <td>{entry.total}</td>
                          <td>
                            <span className="font-mono font-bold text-indigo-700">{entry.percentage}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: HISTORY LOGS */}
        {activeTab === 'history' && (
          <div className="archive-view-container">
            <div className="bento-card archive-card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">Full Attendance Log</h2>
                  <p className="card-subtitle">Chronological record of every session</p>
                </div>
                <span className="badge-light">{filteredHistoryRecords.length} Records</span>
              </div>

              <div className="archive-table-container">
                <table className="archive-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Period</th>
                      <th>Subject & Section</th>
                      <th>Status</th>
                      <th>Verification Mode</th>
                      <th>Marked At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryRecords.map((r) => {
                      const isPresent = r.status === 'present';
                      return (
                        <tr key={r.id}>
                          <td className="font-mono text-xs">{r.attendance_sessions?.session_date}</td>
                          <td>Period {r.attendance_sessions?.period}</td>
                          <td className="font-semibold text-slate-800">
                            {r.attendance_sessions?.classes?.subject || 'Class'}
                          </td>
                          <td>
                            <span className={`status-badge-sm ${isPresent ? 'badge-active' : 'badge-closed'}`}>
                              {isPresent ? '✓ Present' : '✗ Absent'}
                            </span>
                          </td>
                          <td className="text-xs text-slate-500">
                            {r.mark_mode === 'manual_override' ? '✍️ Manual Teacher Override' : '🔐 Biometric Passkey'}
                          </td>
                          <td className="text-xs text-slate-400 font-mono">
                            {r.marked_at ? new Date(r.marked_at).toLocaleTimeString() : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: PROFILE & CUSTOMIZATION */}
        {activeTab === 'profile' && (
          <div className="archive-view-container max-w-xl mx-auto">
            <div className="bento-card p-6">
              <h2 className="card-title mb-4">Student Profile & Biometric Settings</h2>

              <div className="flex items-center gap-4 mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <Image
                  src={profileImage}
                  alt="Profile Avatar"
                  width={64}
                  height={64}
                  className="rounded-full border-2 border-indigo-500 bg-white shadow"
                  unoptimized
                />
                <div>
                  <h3 className="text-base font-bold text-slate-800">{profile?.full_name || 'Student'}</h3>
                  <p className="text-xs text-slate-500 font-mono">Roll: {profile?.roll_number || 'N/A'}</p>
                  <p className="text-xs text-emerald-600 font-medium mt-0.5">
                    {hasBiometric ? '✓ WebAuthn Passkey Active' : '⚠️ Biometrics Not Registered'}
                  </p>
                </div>
              </div>

              <div className="mb-6">
                <label className="form-label mb-2">Choose Avatar</label>
                <div className="flex gap-2 flex-wrap">
                  {DEFAULT_AVATARS.map((avatar, idx) => (
                    <button
                      key={idx}
                      onClick={() => saveProfileImage(avatar)}
                      className={`p-1 rounded-full border-2 transition-all ${profileImage === avatar ? 'border-indigo-600 scale-110 shadow-sm' : 'border-transparent hover:border-slate-300'}`}
                    >
                      <Image
                        src={avatar}
                        alt="Avatar Option"
                        width={42}
                        height={42}
                        className="rounded-full"
                        unoptimized
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <button
                  onClick={registerBiometric}
                  disabled={biometricBusy || biometricReady !== true}
                  className="btn-secondary w-full py-2.5 text-xs font-semibold mb-2"
                >
                  {biometricBusy ? 'Registering...' : '🔄 Re-register Biometric Passkey'}
                </button>

                <button onClick={handleLogout} className="btn-danger w-full py-2.5 text-xs font-semibold">
                  🚪 Sign Out of Student Account
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
