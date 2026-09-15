# Nova Class Web MVP

Token-based attendance system for college classes with teacher, student, and department-admin dashboards.

## Tech Stack

- Next.js 14 + TypeScript
- Supabase (Auth + Postgres + RLS)
- Zod validation
- Vitest unit tests

## Features (MVP)

- Teacher login and dashboard
- Department HOD/Admin dashboard (year-wise student list, monthly attendance export, add student)
- Create attendance session by `department + section + subject + period + date`
- 30-second live token generation and refresh
- Student token submit flow
- One attendance mark per student per session
- Auto-absent marking when session closes
- Student attendance history and subject-wise percentage
- Basic rate limiting on attendance submit API

## Environment Variables

Copy `.env.example` to `.env.local` and fill values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WEBAUTHN_RP_NAME=Nova Class
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
```

For mobile passkeys and biometrics in production, move these to your live HTTPS
domain, for example:

```bash
WEBAUTHN_RP_ID=attendance.example.com
WEBAUTHN_ORIGIN=https://attendance.example.com
```

## Setup

```bash
npm install
```

### Supabase schema and seed

Run `supabase/schema.sql`, then `supabase/seed.sql` in your Supabase SQL editor.

## Run

```bash
npm run dev
```

Open `http://127.0.0.1:3001` (or your configured host/port).

For Android and iPhone biometric testing, use Safari on iOS or Chrome on
Android over HTTPS. A temporary tunnel can work for testing, but a stable public
domain is the reliable production path.

## Validate

```bash
npm test
npm run lint
npm run build
```

## Demo dataset note

Extracted class dataset files are available one level up in project:

- `../it_students_extracted.csv`
- `../it_students_extracted.json`

You can map this into `profiles` + `enrollments` for final demo import.
