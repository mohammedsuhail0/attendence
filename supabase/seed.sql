-- ============================================
-- Seed Data for Demo
-- ============================================
-- NOTE: Run this AFTER creating users in Supabase Auth.
-- The trigger will auto-create profiles, then this script maps them to class data.
--
-- Demo users to create in Supabase Dashboard > Authentication > Users:
--   teacher1@demo.com (password: demo123456, metadata: {"role":"teacher","full_name":"Dr. Sharma"})
--   teacher2@demo.com (password: demo123456, metadata: {"role":"teacher","full_name":"Prof. Kumar"})
--   student1@demo.com (password: demo123456, metadata: {"role":"student","full_name":"Rahul Verma"})
--   student2@demo.com (password: demo123456, metadata: {"role":"student","full_name":"Priya Singh"})
--   student3@demo.com (password: demo123456, metadata: {"role":"student","full_name":"Amit Patel"})
--   student4@demo.com (password: demo123456, metadata: {"role":"student","full_name":"Sneha Rao"})
--   student5@demo.com (password: demo123456, metadata: {"role":"student","full_name":"Vikram Joshi"})

-- Step 1: Update profile details
UPDATE profiles SET department='IT', section='A' WHERE email='teacher1@demo.com';
UPDATE profiles SET department='IT', section='A' WHERE email='teacher2@demo.com';
UPDATE profiles SET department='IT', section='A', roll_number='IT001' WHERE email='student1@demo.com';
UPDATE profiles SET department='IT', section='A', roll_number='IT002' WHERE email='student2@demo.com';
UPDATE profiles SET department='IT', section='A', roll_number='IT003' WHERE email='student3@demo.com';
UPDATE profiles SET department='IT', section='A', roll_number='IT004' WHERE email='student4@demo.com';
UPDATE profiles SET department='IT', section='A', roll_number='IT005' WHERE email='student5@demo.com';

-- Step 2: Create class subjects for teachers (safe re-run)
INSERT INTO classes (department, section, subject, teacher_id)
SELECT 'IT', 'A', 'Data Structures', id FROM profiles WHERE email='teacher1@demo.com'
ON CONFLICT (department, section, subject) DO NOTHING;

INSERT INTO classes (department, section, subject, teacher_id)
SELECT 'IT', 'A', 'DBMS', id FROM profiles WHERE email='teacher1@demo.com'
ON CONFLICT (department, section, subject) DO NOTHING;

INSERT INTO classes (department, section, subject, teacher_id)
SELECT 'IT', 'A', 'Operating Systems', id FROM profiles WHERE email='teacher2@demo.com'
ON CONFLICT (department, section, subject) DO NOTHING;

-- Step 3: Enroll all IT-A students into all IT-A classes (safe re-run)
INSERT INTO enrollments (student_id, class_id)
SELECT p.id, c.id
FROM profiles p
CROSS JOIN classes c
WHERE p.role = 'student'
  AND p.department = 'IT'
  AND p.section = 'A'
  AND c.department = 'IT'
  AND c.section = 'A'
ON CONFLICT (student_id, class_id) DO NOTHING;
