# Smart Attendance - Patent Technical Disclosure

## 1. Invention Title
Smart Attendance System for Classroom Presence Verification Using Time-Bound Session Tokens and Platform Biometric Web Authentication

## 2. Field of Invention
This invention relates to digital attendance systems, identity verification, and secure educational workflow automation. It combines classroom session orchestration, device-native biometric verification, and automated attendance state management.

## 3. Problem Addressed
Conventional attendance methods (paper roll call, visual confirmation, static QR, simple OTP) are:
- vulnerable to proxy attendance,
- time-consuming for instructors,
- difficult to audit at scale,
- weak in real-time integrity controls.

The invention addresses these issues through a multi-layer verification flow and session-state controlled attendance lifecycle.

## 4. Core Invention Summary
The system verifies attendance only when all of the following are true:
1. The student is authenticated and role-authorized.
2. The student belongs to the class enrollment mapped to an active session.
3. A short-lived session token is valid at submission time.
4. WebAuthn biometric assertion for the student passes challenge verification.
5. A duplicate attendance mark for the same student-session pair does not exist.

Attendance records are then persisted with status and mode metadata, and non-marked students are automatically resolved as absent when the session closes.

## 5. Novel Technical Combination
The novelty is in the operational coupling of:
1. Time-bounded classroom session token,
2. Mandatory platform WebAuthn verification,
3. Enrollment-constrained session membership checks,
4. Session closure auto-resolution of unmarked participants,
5. Monthly scoped ranking and attendance analytics.

This layered combination creates a practical anti-proxy attendance protocol suitable for live classroom operations.

## 6. System Components

### 6.1 Client Applications
- Student interface:
  - biometric registration,
  - token input and attendance submit,
  - monthly attendance and leaderboard views.
- Teacher interface:
  - session creation, token refresh, session close,
  - manual override operations,
  - attendance monitoring and history.

### 6.2 Server Layer
- API endpoints for:
  - sessions,
  - attendance submit,
  - attendance history,
  - leaderboard,
  - WebAuthn option generation and verification.

### 6.3 Data Layer
- Relational storage for:
  - users/profiles/roles,
  - class definitions and enrollments,
  - session metadata and lifecycle status,
  - attendance records with status and mark mode.

### 6.4 Security Layer
- Role-based access checks,
- session ownership checks (teacher side),
- enrollment constraints,
- request validation,
- attendance submit rate limiting,
- challenge-response verification for WebAuthn.

## 7. Operational Workflow (End-to-End)

### 7.1 Teacher Session Creation
1. Teacher selects class, date, and period.
2. System creates active attendance session.
3. System generates time-bound token and expiry timestamp.
4. Token is shared in class by instructor.

### 7.2 Student Attendance Marking
1. Student enters token.
2. Client requests authentication options.
3. Server returns challenge and allowed credential metadata.
4. Device prompts platform authenticator flow.
5. Student completes biometric challenge (or OS fallback according to platform policy).
6. Client sends token + assertion to submit endpoint.

### 7.3 Server Verification Sequence
1. Validate request schema.
2. Validate role (student only for submit).
3. Validate active session and token match.
4. Validate token expiry.
5. Validate class enrollment mapping.
6. Validate challenge/assertion using stored credential public key.
7. Reject duplicate marks for same student-session.
8. Persist attendance as present with mark metadata.

### 7.4 Session Closure and Auto-Absent Logic
1. Teacher closes session (or stale session cleanup occurs).
2. System enumerates enrolled students for the class.
3. Students without records for the session are inserted as absent.
4. Finalized session history remains auditable.

## 8. Data Model (Functional View)
- profiles:
  - user id, role, roll number, biometric credential/challenge fields.
- classes:
  - subject/department/section and teacher ownership.
- enrollments:
  - student-class mapping.
- attendance_sessions:
  - class, teacher, date, period, token, expiry, status.
- attendance_records:
  - session id, student id, status, mark mode, timestamp, marker metadata.

## 9. Attendance Math and Ranking Logic
- Percentage formula:
  - percentage = round((present / total) * 100),
  - if total is zero, percentage is zero.
- Leaderboard scope:
  - monthly by default (calendar month window).
- Student monthly card and leaderboard row are synchronized to the same monthly metric logic.

## 10. Security and Integrity Controls
1. Authentication and role gating at endpoint boundaries.
2. Session ownership enforcement for teacher-only operations.
3. Enrollment checks to prevent out-of-class marking.
4. Challenge freshness via server-generated WebAuthn challenge storage.
5. Unique student-session attendance constraint.
6. Rate limiting on submission-sensitive endpoints.
7. Explicit error handling for unauthorized, forbidden, conflict, and validation states.

## 11. Performance and Reliability Strategy
1. Cache-first UI hydration for responsiveness.
2. no-store reads for correctness-critical endpoints.
3. Background refresh throttling and in-flight guards.
4. Reduced payload selection where practical.
5. Utility-level regression tests for month boundaries and percentage calculations.

## 12. Technical Differentiators (Claim-Oriented)
1. Biometric-gated attendance submission tied to time-bounded classroom tokens.
2. Enrollment-constrained attendance validation pipeline with duplicate prevention.
3. Session-close auto-absent materialization as part of lifecycle completion.
4. Unified monthly attendance metric used consistently for card and leaderboard outputs.
5. Teacher-side manual override with immediate state propagation while preserving audit mode metadata.

## 13. Example Independent Claim Draft (Informal)
A computer-implemented attendance method comprising:
1. creating a classroom session with a generated token and expiration time,
2. receiving a user token and biometric assertion from a student device,
3. validating session activity, token validity, enrollment relation, and biometric assertion,
4. conditionally storing a present attendance record for a unique student-session tuple,
5. closing the session and auto-generating absent records for enrolled students lacking attendance records.

## 14. Example Dependent Claim Directions (Informal)
1. The method of claim 1, wherein biometric assertion uses platform WebAuthn authenticators with required user verification.
2. The method of claim 1, wherein leaderboard ranking is computed on monthly attendance windows.
3. The method of claim 1, wherein attendance records include mark mode metadata distinguishing biometric, manual override, and auto-absent pathways.
4. The method of claim 1, wherein API access is constrained by role and ownership validation.

## 15. Practical Deployment Notes
- Runtime platform: Next.js-based full-stack web deployment.
- Database/auth: managed relational/auth backend.
- Browser requirement: secure origin and WebAuthn-capable browser for biometric flow.
- Mobile baseline: modern Android/iOS browsers with platform authenticator support.

## 16. Limitations and Compliance Notes
1. Device OS may present fallback unlock options (PIN/pattern/password) in native passkey UI; this prompt is OS/browser controlled.
2. This document is a technical disclosure, not legal advice.
3. Formal claim language should be finalized by a registered patent professional.

## 17. Conclusion
Smart Attendance provides a practical and defensible technical framework for classroom attendance integrity by combining session-state control, biometric challenge verification, enrollment-scoped validation, and lifecycle-complete attendance finalization with monthly analytics.
