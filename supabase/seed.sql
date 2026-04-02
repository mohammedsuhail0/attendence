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
UPDATE profiles SET department='IT', section='1' WHERE email='teacher1@demo.com';
UPDATE profiles SET department='IT', section='1' WHERE email='teacher2@demo.com';
UPDATE profiles SET department='IT', section='1', roll_number='IT001' WHERE email='student1@demo.com';
UPDATE profiles SET department='IT', section='1', roll_number='IT002' WHERE email='student2@demo.com';
UPDATE profiles SET department='IT', section='1', roll_number='IT003' WHERE email='student3@demo.com';
UPDATE profiles SET department='IT', section='1', roll_number='IT004' WHERE email='student4@demo.com';
UPDATE profiles SET department='IT', section='1', roll_number='IT005' WHERE email='student5@demo.com';

-- Step 2: Create class subjects for teachers (safe re-run)
INSERT INTO classes (department, section, subject, teacher_id)
SELECT department, section, subject, teacher_id
FROM (
  SELECT 'IT' AS department, '1' AS section, 'Programming Fundamentals' AS subject, id AS teacher_id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '1', 'Digital Logic', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '1', 'Mathematics I', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '2', 'Data Structures', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '2', 'DBMS', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '2', 'Operating Systems', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '3', 'Computer Networks', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '3', 'Software Engineering', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '3', 'Web Technology', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '4', 'Cloud Computing', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '4', 'Information Security', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'IT', '4', 'AI Fundamentals', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '1', 'Engineering Mathematics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '1', 'Problem Solving in C', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '1', 'Physics for Computing', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '2', 'Data Structures', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '2', 'Object Oriented Programming', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '2', 'DBMS', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '3', 'Computer Networks', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '3', 'Design and Analysis of Algorithms', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '3', 'Operating Systems', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '4', 'Machine Learning', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '4', 'Compiler Design', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'CSE', '4', 'Cloud Computing', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '1', 'Statistics for AI', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '1', 'Python Programming', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '1', 'Linear Algebra', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '2', 'Data Structures', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '2', 'Probability and Statistics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '2', 'DBMS', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '3', 'Machine Learning', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '3', 'Data Mining', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '3', 'Deep Learning Basics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '4', 'NLP', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '4', 'Computer Vision', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'AIDS', '4', 'Big Data Analytics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '1', 'Engineering Mechanics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '1', 'Engineering Drawing', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '1', 'Mathematics I', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '2', 'Surveying', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '2', 'Strength of Materials', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '2', 'Fluid Mechanics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '3', 'Structural Analysis', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '3', 'Geotechnical Engineering', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '3', 'Transportation Engineering', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '4', 'Environmental Engineering', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '4', 'Construction Management', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Civil', '4', 'Design of Structures', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '1', 'Engineering Graphics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '1', 'Basic Thermodynamics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '1', 'Workshop Technology', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '2', 'Fluid Mechanics', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '2', 'Materials Science', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '2', 'Manufacturing Processes', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '3', 'Heat Transfer', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '3', 'Theory of Machines', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '3', 'Machine Design', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '4', 'CAD/CAM', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '4', 'Automobile Engineering', id FROM profiles WHERE email='teacher1@demo.com'
  UNION ALL
  SELECT 'Mech', '4', 'Industrial Engineering', id FROM profiles WHERE email='teacher1@demo.com'
) catalog
ON CONFLICT (department, section, subject) DO NOTHING;

-- Step 3: Enroll all IT year 1 students into all IT year 1 classes (safe re-run)
INSERT INTO enrollments (student_id, class_id)
SELECT p.id, c.id
FROM profiles p
CROSS JOIN classes c
WHERE p.role = 'student'
  AND p.department = 'IT'
  AND p.section = '1'
  AND c.department = 'IT'
  AND c.section = '1'
ON CONFLICT (student_id, class_id) DO NOTHING;
