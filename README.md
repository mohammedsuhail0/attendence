# Smart Attendance Web MVP

Token-based attendance system for college classes with teacher and student dashboards.

## Tech Stack

- Next.js 14 + TypeScript
- Supabase (Auth + Postgres + RLS)
- Zod validation
- Vitest unit tests

## Features (MVP)

- Teacher login and dashboard
- Create attendance session by `department + section + subject + period + date`
- 15-second live token generation and refresh
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
WEBAUTHN_RP_NAME=SmartAttendance
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
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

Open `http://localhost:3000`.

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

