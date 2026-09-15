-- Run this on existing databases before using the ADMIN dashboard.
-- It expands the role constraint so profiles can store admin users.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('teacher', 'student', 'admin'));
