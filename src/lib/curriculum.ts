import type { Class } from '@/types/database';

export interface CurriculumItem {
  id: string;
  department: string;
  section: string;
  subject: string;
  created_at: string;
}

const RAW_CURRICULUM = [
  // IT
  { dept: 'IT', sec: '1', sub: 'Programming Fundamentals' },
  { dept: 'IT', sec: '1', sub: 'Digital Logic' },
  { dept: 'IT', sec: '1', sub: 'Mathematics I' },
  { dept: 'IT', sec: '2', sub: 'Data Structures' },
  { dept: 'IT', sec: '2', sub: 'DBMS' },
  { dept: 'IT', sec: '2', sub: 'Operating Systems' },
  { dept: 'IT', sec: '3', sub: 'Computer Networks' },
  { dept: 'IT', sec: '3', sub: 'Software Engineering' },
  { dept: 'IT', sec: '3', sub: 'Web Technology' },
  { dept: 'IT', sec: '4', sub: 'Cloud Computing' },
  { dept: 'IT', sec: '4', sub: 'Information Security' },
  { dept: 'IT', sec: '4', sub: 'AI Fundamentals' },

  // CSE
  { dept: 'CSE', sec: '1', sub: 'Engineering Mathematics' },
  { dept: 'CSE', sec: '1', sub: 'Problem Solving in C' },
  { dept: 'CSE', sec: '1', sub: 'Physics for Computing' },
  { dept: 'CSE', sec: '2', sub: 'Data Structures' },
  { dept: 'CSE', sec: '2', sub: 'Object Oriented Programming' },
  { dept: 'CSE', sec: '2', sub: 'DBMS' },
  { dept: 'CSE', sec: '3', sub: 'Computer Networks' },
  { dept: 'CSE', sec: '3', sub: 'Design and Analysis of Algorithms' },
  { dept: 'CSE', sec: '3', sub: 'Operating Systems' },
  { dept: 'CSE', sec: '4', sub: 'Machine Learning' },
  { dept: 'CSE', sec: '4', sub: 'Compiler Design' },
  { dept: 'CSE', sec: '4', sub: 'Cloud Computing' },

  // AIDS
  { dept: 'AIDS', sec: '1', sub: 'Statistics for AI' },
  { dept: 'AIDS', sec: '1', sub: 'Python Programming' },
  { dept: 'AIDS', sec: '1', sub: 'Linear Algebra' },
  { dept: 'AIDS', sec: '2', sub: 'Data Structures' },
  { dept: 'AIDS', sec: '2', sub: 'Probability and Statistics' },
  { dept: 'AIDS', sec: '2', sub: 'DBMS' },
  { dept: 'AIDS', sec: '3', sub: 'Machine Learning' },
  { dept: 'AIDS', sec: '3', sub: 'Data Mining' },
  { dept: 'AIDS', sec: '3', sub: 'Deep Learning Basics' },
  { dept: 'AIDS', sec: '4', sub: 'NLP' },
  { dept: 'AIDS', sec: '4', sub: 'Computer Vision' },
  { dept: 'AIDS', sec: '4', sub: 'Big Data Analytics' },

  // Civil
  { dept: 'Civil', sec: '1', sub: 'Engineering Mechanics' },
  { dept: 'Civil', sec: '1', sub: 'Engineering Drawing' },
  { dept: 'Civil', sec: '1', sub: 'Mathematics I' },
  { dept: 'Civil', sec: '2', sub: 'Surveying' },
  { dept: 'Civil', sec: '2', sub: 'Strength of Materials' },
  { dept: 'Civil', sec: '2', sub: 'Fluid Mechanics' },
  { dept: 'Civil', sec: '3', sub: 'Structural Analysis' },
  { dept: 'Civil', sec: '3', sub: 'Geotechnical Engineering' },
  { dept: 'Civil', sec: '3', sub: 'Transportation Engineering' },
  { dept: 'Civil', sec: '4', sub: 'Environmental Engineering' },
  { dept: 'Civil', sec: '4', sub: 'Construction Management' },
  { dept: 'Civil', sec: '4', sub: 'Design of Structures' },

  // Mech
  { dept: 'Mech', sec: '1', sub: 'Engineering Graphics' },
  { dept: 'Mech', sec: '1', sub: 'Basic Thermodynamics' },
  { dept: 'Mech', sec: '1', sub: 'Workshop Technology' },
  { dept: 'Mech', sec: '2', sub: 'Fluid Mechanics' },
  { dept: 'Mech', sec: '2', sub: 'Materials Science' },
  { dept: 'Mech', sec: '2', sub: 'Manufacturing Processes' },
  { dept: 'Mech', sec: '3', sub: 'Heat Transfer' },
  { dept: 'Mech', sec: '3', sub: 'Theory of Machines' },
  { dept: 'Mech', sec: '3', sub: 'Machine Design' },
  { dept: 'Mech', sec: '4', sub: 'CAD/CAM' },
  { dept: 'Mech', sec: '4', sub: 'Automobile Engineering' },
  { dept: 'Mech', sec: '4', sub: 'Industrial Engineering' },
] as const;

export const CANONICAL_CURRICULUM: Class[] = RAW_CURRICULUM.map((item, idx) => ({
  id: `c1a55000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
  department: item.dept,
  section: item.sec,
  subject: item.sub,
  teacher_id: '00000000-0000-0000-0000-000000000000',
  created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
}));

export function findCurriculumClass(idOrCriteria: string | { department: string; section: string; subject: string }) {
  if (typeof idOrCriteria === 'string') {
    return CANONICAL_CURRICULUM.find((c) => c.id === idOrCriteria) || null;
  }
  return (
    CANONICAL_CURRICULUM.find(
      (c) =>
        c.department === idOrCriteria.department &&
        c.section === idOrCriteria.section &&
        c.subject.toLowerCase() === idOrCriteria.subject.toLowerCase()
    ) || null
  );
}
