# Smart Attendance - Hackathon Blueprint

## 1. Problem Statement
Traditional classroom attendance is slow, proxy-prone, and hard to audit. Teachers lose class time, and students cannot easily track real attendance status.

## 2. Solution Summary
Smart Attendance is a token + biometric attendance platform with dedicated teacher and student dashboards.

- Teachers create live attendance sessions per class/period/date.
- Students submit attendance using a short-lived token and WebAuthn biometric verification.
- The system records present/absent status with mark mode metadata and monthly leaderboard analytics.

## 3. Tech Stack and Why It Was Chosen

### Frontend
- Next.js 14 (App Router)
- React 18
- TypeScript

Why:
- Fast development and production-ready SSR/ISR ecosystem.
- Strong typing for safer hackathon iteration and fewer runtime bugs.

### Backend
- Next.js API Routes (server-side endpoints)
- Supabase Postgres
- Supabase Auth + RLS

Why:
- Rapid full-stack implementation without separate backend hosting complexity.
- SQL + RLS gives strong data-level access control.

### Validation and Security
- Zod for request validation
- WebAuthn via @simplewebauthn/browser and @simplewebauthn/server
- Rate limiting for attendance submit endpoint

Why:
- Prevent malformed requests.
- Reduce spoofing/proxy attendance risk.
- Add anti-abuse protection.

### Quality and Tooling
- Vitest unit tests
- ESLint + TypeScript
- Vercel deployment pipeline

Why:
- Stable release confidence under hackathon time constraints.

## 4. Languages Used
- TypeScript: application logic (frontend + API)
- SQL: schema, migrations, seeds
- JavaScript (Node scripts): utility scripts for data/photo sync
- CSS: app styling

## 5. High-Level Architecture
1. User logs in using Supabase Auth.
2. Role-based dashboard loads (teacher or student).
3. Teacher creates attendance session (token + expiry).
4. Student submits token + biometric assertion.
5. Server verifies:
   - authentication
   - role
   - enrollment
   - token validity
   - duplicate submission
   - biometric challenge/response
6. Attendance record is inserted.
7. Session close flow auto-marks absentees.
8. Monthly leaderboard and attendance metrics are served via API.

## 6. Core Modules and Responsibilities

### Teacher Module
- Session creation (class + period + date)
- Token refresh and session close
- Attendance list monitoring
- Manual override marking
- Session history with mode-wise summary (biometric/manual/auto-absent)

### Student Module
- Biometric setup and verification
- Token submission
- Attendance history view
- Monthly attendance card
- Monthly race leaderboard

### Shared Utility Layer
- Token generation and expiry checks
- Date/month key normalization (Asia/Kolkata)
- Attendance percentage calculation helper
- Basic request rate limit helper

## 7. Backend Data Model (Postgres)

### Key Tables
- profiles: identity, role, roll number, biometric credentials/challenge
- classes: department/section/subject with owner teacher
- enrollments: student-class mapping
- attendance_sessions: session token, period, date, status, expiry
- attendance_records: status, mark mode, marker, timestamp

### Important Constraints
- One session per class + period + date
- One attendance record per student per session
- Attendance status check constraints
- Session status check constraints

## 8. Security Model

### Authentication and Authorization
- Supabase Auth for identity
- Role checks in APIs
- Ownership checks (teacher can manage only own classes/sessions)
- Enrollment checks (student must belong to class)

### Data Access
- Row Level Security enabled across domain tables
- Policies for student self-read and teacher session-scoped reads

### Anti-Abuse Controls
- Submit endpoint rate limiting by IP
- Token TTL enforcement
- Duplicate submission prevention

### Anti-Proxy Strategy
- Biometric/WebAuthn verification required before marking present

## 9. Attendance Logic (Current)

### Session Lifecycle
1. Teacher creates active session with a short token validity window.
2. Student submits token and biometric proof.
3. Present record is inserted with mark mode.
4. On close or stale session cleanup, unmarked enrolled students are marked absent.

### Monthly Metric Logic
- Monthly scope is default for leaderboard.
- Date range uses month start to next month start boundaries.
- Percentage formula is shared utility:
  percentage = round((present / total) * 100), with total=0 -> 0.
- Student monthly card and student leaderboard row use the same monthly math source.

## 10. API Surface (Hackathon Demo)
- /api/classes
- /api/sessions
- /api/sessions/[id]/refresh
- /api/sessions/[id]/close
- /api/sessions/[id]/attendance
- /api/sessions/[id]/manual-override
- /api/attendance/submit
- /api/attendance/history
- /api/attendance/leaderboard
- /api/webauthn/register/options
- /api/webauthn/register/verify
- /api/webauthn/authenticate/options

## 11. Performance Strategy
- Cache-first UI hydration for quick perceived load
- No-store refresh for correctness-critical attendance reads
- Polling with visibility guards
- API payload trimming where possible
- Batched and optimized list refresh patterns in teacher workflows

## 12. Reliability Improvements Implemented
- Shared attendance percentage helper to avoid formula drift
- Shared month-key helpers to keep client/server month boundaries aligned
- Regression tests for attendance math and month rollover
- Focus/visibility refresh hooks to reduce stale display windows

## 13. Testing and Validation
- Unit tests: utility and WebAuthn config modules
- Linting: Next.js ESLint rules
- Build checks: Next production build before deployment
- Runtime checks: endpoint validation + explicit error responses

## 14. Deployment and DevOps
- Hosting: Vercel
- Database/Auth/Storage: Supabase
- Environment config via .env.local and Vercel env vars
- Production alias mapping for stable demo URLs

## 15. Hackathon Q&A Ready Answers

### Q: How do you prevent proxy attendance?
A: Attendance submit requires successful WebAuthn biometric verification tied to the student profile credential, plus token and enrollment checks.

### Q: How do you ensure fairness in ranking?
A: Leaderboard uses monthly scope by default, so every month is a fresh competition window.

### Q: How do you prevent duplicate/fake records?
A: Unique constraint on (session_id, student_id), duplicate API check, role/auth checks, and validated payload schema.

### Q: What happens if a student does not mark attendance?
A: On session closure, all unmarked enrolled students are automatically marked absent.

### Q: Is the app scalable?
A: Current architecture supports pilot/department scale. Further scaling path: monthly aggregates/materialized views, query partitioning, and observability dashboards.

## 16. Known Tradeoffs and Future Roadmap
- Add all-time leaderboard as secondary view alongside monthly default
- Add admin analytics and exports
- Improve observability (structured logs + metrics)
- Introduce aggregate tables/materialized views for very large cohorts
- Add E2E tests for core attendance lifecycle

## 17. Conclusion
Smart Attendance delivers a practical, secure, and demo-ready attendance platform with biometric-backed presence verification, teacher workflow automation, and monthly performance analytics designed for hackathon impact and real-world extensibility.
