'use client';

import { useState, useEffect, useCallback } from 'react';
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
const UploadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
);
const TrophyIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
);

const AVATAR_OPTIONS = ['Felix', 'Aneka', 'Ginger', 'Casper', 'Jack', 'Bubba', 'Milo', 'Luna', 'Oliver', 'Mimi'];

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
  id: string;
  full_name: string;
  roll_number: string | null;
  webauthn_credential: unknown | null;
  photo_path: string | null;
  custom_photo_path: string | null;
}

interface LeaderboardEntry {
  id: string;
  full_name: string;
  custom_photo_path: string | null;
  photo_path: string | null;
  percentage: number;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getDisplayUrl(customPath: string | null, officialPath: string | null) {
  const activePath = customPath || officialPath;
  if (!activePath) return null;
  if (activePath.startsWith('db:')) {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${activePath.split(':')[1]}`;
  }
  return null; // For storage paths, a signed URL is needed. This is a placeholder for non-async parts.
}

const supabase = createClient();

export default function StudentDashboard() {
  const router = useRouter();

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [currentTab, setCurrentTab] = useState<'home' | 'subjects' | 'history' | 'profile' | 'leaderboard'>('subjects');
  
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const fetchPhotoUrl = useCallback(async (customPath: string | null, officialPath: string | null) => {
    const activePath = customPath || officialPath;
    if (!activePath) { setPhotoUrl(null); return; }
    if (activePath.startsWith('db:')) {
      setPhotoUrl(`https://api.dicebear.com/7.x/avataaars/svg?seed=${activePath.split(':')[1]}`);
    } else {
      const { data } = await supabase.storage.from('student-photos').createSignedUrl(activePath, 3600);
      if (data) setPhotoUrl(data.signedUrl);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/attendance/history');
    const data = await res.json();
    if (data.records) setRecords(data.records);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const res = await fetch('/api/attendance/leaderboard');
      const data = await res.json();
      if (data.leaderboard) setLeaderboard(data.leaderboard);
    } catch { setError('Failed to load leaderboard.'); }
    finally { setLeaderboardLoading(false); }
  }, []);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (p) {
        setProfile(p as StudentProfile);
        setHasBiometric(Boolean(p.webauthn_credential));
        fetchPhotoUrl(p.custom_photo_path, p.photo_path);
      }
      loadHistory();
      setHasWebAuthn(browserSupportsWebAuthn());
    }
    init();
  }, [fetchPhotoUrl, loadHistory]);

  useEffect(() => {
    if (currentTab === 'leaderboard') loadLeaderboard();
  }, [currentTab, loadLeaderboard]);

  async function registerBiometric() {
    setError(''); setSuccess(''); setBiometricBusy(true);
    try {
      const optionsRes = await fetch('/api/webauthn/register/options', { method: 'POST' });
      const optionsData = await optionsRes.json();
      const registrationResponse = await startRegistration(optionsData.options);
      await fetch('/api/webauthn/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: registrationResponse }),
      });
      setHasBiometric(true); setSuccess('Passkey registered.');
    } catch (e: unknown) { setError(toErrorMessage(e, 'Setup failed.')); } finally { setBiometricBusy(false); }
  }

  async function submitAttendance(e: React.FormEvent) {
    if (e) e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (!hasBiometric) throw new Error('Set up biometrics first.');
      const optionsRes = await fetch('/api/webauthn/authenticate/options', { method: 'POST' });
      const optionsData = await optionsRes.json();
      const assertion = await startAuthentication(optionsData.options);
      const res = await fetch('/api/attendance/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.toUpperCase(), assertion }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess('Attendance marked!'); setToken('');
      loadHistory();
    } catch (e: unknown) { setError(toErrorMessage(e, 'Failed.')); } finally { setLoading(false); }
  }

  async function handleAvatarSelect(seed: string) {
    if (!profile) return;
    const newPath = `db:${seed}`;
    const { error } = await supabase.from('profiles').update({ custom_photo_path: newPath }).eq('id', profile.id);
    if (!error) {
      setProfile({ ...profile, custom_photo_path: newPath });
      fetchPhotoUrl(newPath, profile.photo_path);
      setSuccess('Avatar updated.');
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    try {
      const filePath = `custom/${profile.id}_${Date.now()}.${file.name.split('.').pop()}`;
      await supabase.storage.from('student-photos').upload(filePath, file);
      await supabase.from('profiles').update({ custom_photo_path: filePath }).eq('id', profile.id);
      setProfile({ ...profile, custom_photo_path: filePath });
      fetchPhotoUrl(filePath, profile.photo_path);
      setSuccess('Photo uploaded.');
    } catch (err) { setError(toErrorMessage(err, 'Upload failed.')); } finally { setUploading(false); }
  }

  // --- Aggregate Metrics (Defensive against Supabase Array/Object joins) ---
  const subjectMap = new Map<string, { total: number; present: number; code: string }>();
  for (const r of (records || [])) {
    // Supabase can return joined data as an object or a single-element array depending on schema introspection
    const session = Array.isArray(r.attendance_sessions) ? r.attendance_sessions[0] : r.attendance_sessions;
    const cls = session ? (Array.isArray(session.classes) ? session.classes[0] : session.classes) : null;
    
    const s = cls?.subject || 'Unknown Subject';
    const e = subjectMap.get(s) || { 
      total: 0, 
      present: 0, 
      code: s.match(/^[A-Z]{2,4}\d{2,4}/)?.[0] || s.substring(0, 3).toUpperCase() + (Math.floor(Math.random() * 900) + 100)
    };
    e.total++; if (r.status === 'present') e.present++;
    subjectMap.set(s, e);
  }
  const subjects = Array.from(subjectMap.entries()).map(([name, stats]) => ({
    name: name.replace(/^[A-Z]{2,4}\d{2,4}\s*(-|:)?\s*/, ''),
    ...stats,
    pct: Math.round((stats.present / stats.total) * 100)
  }));

  const globalPresent = (records || []).filter(r => r.status === 'present').length;
  const globalPct = (records || []).length > 0 ? Math.round((globalPresent / records.length) * 100) : 0;
// Version: 1.2

  const displayPhoto = photoUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile?.full_name || 'Student'}`;

  return (
    <div className="scholarly-page sc-animate-up">
      <header className="sc-header">
        <div className="sc-profile-box">
          <img src={displayPhoto} alt="Profile" />
          <h1 style={{ display: 'none' }}>Smart Attendance</h1>
        </div>
        <div className="sc-notification"><NotificationIcon /></div>
      </header>

      <main>
        {currentTab === 'subjects' && (
          <>
            <div className="sc-title-group"><h2>Course Summary</h2><p>Overview of your current standing</p></div>
            <div className="sc-summary-grid">
              <div className="sc-card-aggregate"><span className="sc-label">Aggregate Attendance</span><span className="sc-value-xl">{globalPct}%</span></div>
              <div className="sc-card-total"><div className="sc-icon-box"><CalendarIcon /></div><div><span className="sc-label">Total Ratio</span><span className="sc-value-lg">{globalPresent}/{records.length}</span></div></div>
            </div>
            <section>
              <div className="sc-section-header"><h3>Active Subjects</h3></div>
              {subjects.map(sub => (
                <div key={sub.code} className="sc-course-card">
                  <div className="sc-course-top"><span className="sc-course-code">{sub.code}</span><span className={`sc-pct-badge ${sub.pct >= 75 ? 'good' : 'bad'}`}>{sub.pct}%</span></div>
                  <h4 className="sc-course-name">{sub.name}</h4>
                  <div className="sc-course-bottom"><span>Attended: {sub.present}/{sub.total}</span></div>
                  <div className="sc-progress-track"><div className={`sc-progress-bar ${sub.pct >= 75 ? 'good' : 'bad'}`} style={{ width: `${sub.pct}%` }} /></div>
                </div>
              ))}
              {subjects.length === 0 && <div className="sc-course-card"><p className="text-dim">No subject data found. Start marking attendance!</p></div>}
            </section>
          </>
        )}

        {currentTab === 'leaderboard' && (
          <>
            <div className="sc-title-group"><h2>Leaderboard</h2><p>Top attendance in your class</p></div>
            {leaderboardLoading ? <div className="sc-course-card"><p className="text-dim">Crunching data...</p></div> : (
              <div className="sc-course-card" style={{ padding: '0.75rem' }}>
                {leaderboard.length === 0 ? <p className="text-dim text-center">Class data pending first sessions.</p> : leaderboard.map((entry, i) => (
                  <div key={entry.id} className="flex-between" style={{ padding: '0.75rem', borderBottom: i < leaderboard.length - 1 ? '1px solid var(--scholarly-border)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ fontWeight: 800, color: 'var(--scholarly-primary)', width: '20px' }}>#{i+1}</span>
                      <img 
                        src={entry.custom_photo_path?.startsWith('db:') ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.custom_photo_path.split(':')[1]}` : (entry.photo_path ? `/api/get-signed-url?path=${entry.photo_path}` : `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.full_name}`)} 
                        alt={entry.full_name} 
                        style={{ width: '40px', height: '40px', borderRadius: '50%' }} 
                      />
                      <div>
                        <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>{entry.full_name}</h4>
                        <p className="sc-timestamp">{entry.percentage >= 90 ? 'Attendance Pro' : 'Regular Student'}</p>
                      </div>
                    </div>
                    <div className={`sc-pct-badge ${entry.percentage >= 75 ? 'good' : 'bad'}`}>{entry.percentage}%</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {currentTab === 'home' && (
          <>
            <div className="sc-title-group"><h2>Welcome back</h2><p>Mark today's session</p></div>
            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}
            <div className="sc-course-card">
              <h3 style={{ marginBottom: '1rem', color: 'var(--scholarly-primary)' }}>Enter Token</h3>
              <form onSubmit={submitAttendance}>
                <div className="form-group">
                  <input type="text" className="form-input" placeholder="____" value={token} onChange={(e) => setToken(e.target.value.toUpperCase().slice(0, 4))} maxLength={4}
                    style={{ fontFamily: 'var(--mono)', fontSize: '2rem', textAlign: 'center', letterSpacing: '0.4em' }} required />
                </div>
                <button type="submit" className="btn btn-primary btn-block" disabled={loading || token.length !== 4}>{loading ? 'Verifying...' : 'Submit Attendance'}</button>
              </form>
            </div>
          </>
        )}

        {currentTab === 'history' && (
          <>
            <div className="sc-title-group"><h2>History</h2><p>Your logbook entries</p></div>
            <div className="sc-course-card" style={{ padding: '0.5rem' }}>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Date</th><th>Subject</th><th>Status</th></tr></thead>
                  <tbody>
                    {(records || []).map(r => {
                      const session = Array.isArray(r.attendance_sessions) ? r.attendance_sessions[0] : r.attendance_sessions;
                      const cls = session ? (Array.isArray(session.classes) ? session.classes[0] : session.classes) : null;
                      return (
                        <tr key={r.id}>
                          <td>{session?.session_date || 'N/A'}</td>
                          <td>{cls?.subject || 'N/A'}</td>
                          <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                        </tr>
                      );
                    })}
                    {(!records || records.length === 0) && <tr><td colSpan={3} className="text-center text-dim">No records found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {currentTab === 'profile' && (
          <>
            <div className="sc-title-group"><h2>Profile</h2><p>Manage your identity</p></div>
            <div className="sc-course-card text-center">
              <img src={displayPhoto} alt="Profile" style={{ width: '100px', height: '100px', borderRadius: '50%', border: '4px solid var(--scholarly-secondary)', marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>{profile?.full_name}</h3>
              <p className="sc-timestamp">Official Roll: {profile?.roll_number}</p>
              
              <div className="sc-avatar-picker text-left">
                <span className="sc-label">Select Dashboard Avatar</span>
                <div className="sc-avatar-grid">
                  {AVATAR_OPTIONS.map(seed => (
                    <button key={seed} className={`sc-avatar-option ${profile?.custom_photo_path === `db:${seed}` ? 'active' : ''}`} onClick={() => handleAvatarSelect(seed)}>
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`} alt={seed} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="sc-upload-section">
                <label className="sc-file-label">
                  <UploadIcon />
                  <span>{uploading ? 'Uploading...' : 'Upload Gallery Photo'}</span>
                  <input type="file" className="sc-file-input" accept="image/*" onChange={handlePhotoUpload} disabled={uploading} />
                </label>
              </div>

              <div className="mt-3">
                <button className="btn btn-outline btn-block mb-2" onClick={registerBiometric} disabled={biometricBusy}>{hasBiometric ? 'Update Passkey' : 'Register Passkey'}</button>
                <button className="btn btn-danger btn-block" onClick={() => { supabase.auth.signOut(); router.push('/login'); }}>Sign Out</button>
              </div>
            </div>
          </>
        )}
      </main>

      <nav className="sc-navbar">
        <button className={`sc-nav-item ${currentTab === 'home' ? 'active' : ''}`} onClick={() => setCurrentTab('home')}><div className="sc-nav-icon"><HomeIcon /></div><span>Home</span></button>
        <button className={`sc-nav-item ${currentTab === 'subjects' ? 'active' : ''}`} onClick={() => setCurrentTab('subjects')}><div className="sc-nav-icon"><BookIcon /></div><span>Subjects</span></button>
        <button className={`sc-nav-item ${currentTab === 'leaderboard' ? 'active' : ''}`} onClick={() => setCurrentTab('leaderboard')}><div className="sc-nav-icon"><TrophyIcon /></div><span>Leaderboard</span></button>
        <button className={`sc-nav-item ${currentTab === 'history' ? 'active' : ''}`} onClick={() => setCurrentTab('history')}><div className="sc-nav-icon"><HistoryIcon /></div><span>History</span></button>
        <button className={`sc-nav-item ${currentTab === 'profile' ? 'active' : ''}`} onClick={() => setCurrentTab('profile')}><div className="sc-nav-icon"><UserIcon /></div><span>Profile</span></button>
      </nav>
    </div>
  );
}
