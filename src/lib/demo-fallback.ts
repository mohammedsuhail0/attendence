export interface DemoUser {
  id: string;
  email: string;
  role: 'teacher' | 'student' | 'admin';
  full_name: string;
  department: string;
  section: string;
  roll_number?: string;
}

export const DEMO_USERS: Record<string, DemoUser> = {
  'teacher1@demo.com': {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'teacher1@demo.com',
    role: 'teacher',
    full_name: 'Dr. Sharma',
    department: 'IT',
    section: '1',
  },
  'teacher2@demo.com': {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'teacher2@demo.com',
    role: 'teacher',
    full_name: 'Prof. Kumar',
    department: 'IT',
    section: '1',
  },
  'hod-it@demo.com': {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'hod-it@demo.com',
    role: 'admin',
    full_name: 'HOD IT',
    department: 'IT',
    section: '1',
  },
  'student1@demo.com': {
    id: '44444444-4444-4444-8444-444444444441',
    email: 'student1@demo.com',
    role: 'student',
    full_name: 'Rahul Verma',
    department: 'IT',
    section: '1',
    roll_number: 'IT001',
  },
  'student2@demo.com': {
    id: '44444444-4444-4444-8444-444444444442',
    email: 'student2@demo.com',
    role: 'student',
    full_name: 'Priya Singh',
    department: 'IT',
    section: '1',
    roll_number: 'IT002',
  },
};

export const DEMO_PASSWORD = 'demo123456';

export function findDemoUser(identifier: string): DemoUser | null {
  const norm = identifier.trim().toLowerCase();
  if (DEMO_USERS[norm]) return DEMO_USERS[norm];

  // Try matching by roll number
  const cleanRoll = identifier.trim().replace(/\s+/g, '').toUpperCase();
  for (const user of Object.values(DEMO_USERS)) {
    if (user.roll_number && user.roll_number.toUpperCase() === cleanRoll) {
      return user;
    }
  }

  return null;
}
