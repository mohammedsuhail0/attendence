-- ============================================
-- Smart Attendance System — Full Schema
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  department TEXT,
  section TEXT,
  roll_number TEXT,
  webauthn_credential JSONB,
  webauthn_challenge TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Classes (department+section+subject combos)
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,
  section TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department, section, subject)
);

-- 3. Enrollments (student <-> class)
CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, class_id)
);

-- 4. Attendance Sessions
CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id),
  teacher_id UUID NOT NULL REFERENCES profiles(id),
  token TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 8),
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(class_id, period, session_date)
);

-- 5. Attendance Records
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, student_id)
);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Classes: all can read, teachers can insert own
CREATE POLICY "classes_select" ON classes FOR SELECT USING (true);
CREATE POLICY "classes_insert" ON classes FOR INSERT WITH CHECK (auth.uid() = teacher_id);

-- Enrollments: all can read
CREATE POLICY "enrollments_select" ON enrollments FOR SELECT USING (true);
CREATE POLICY "enrollments_insert" ON enrollments FOR INSERT WITH CHECK (true);

-- Sessions: all can read, teachers can insert/update own
CREATE POLICY "sessions_select" ON attendance_sessions FOR SELECT USING (true);
CREATE POLICY "sessions_insert" ON attendance_sessions FOR INSERT WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "sessions_update" ON attendance_sessions FOR UPDATE USING (auth.uid() = teacher_id);

-- Records: students see own, teachers see their sessions
CREATE POLICY "records_select_student" ON attendance_records FOR SELECT
  USING (auth.uid() = student_id);
CREATE POLICY "records_select_teacher" ON attendance_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM attendance_sessions s
      WHERE s.id = attendance_records.session_id AND s.teacher_id = auth.uid()
    )
  );
CREATE POLICY "records_insert" ON attendance_records FOR INSERT WITH CHECK (true);

-- ============================================
-- Auto-create profile on auth signup (trigger)
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
