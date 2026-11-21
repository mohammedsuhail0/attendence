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
    roll_number: '160524737050',
  },
  'student2@demo.com': {
    id: '44444444-4444-4444-8444-444444444442',
    email: 'student2@demo.com',
    role: 'student',
    full_name: 'Priya Singh',
    department: 'IT',
    section: '1',
    roll_number: '160524737056',
  },
};

export const DEMO_PASSWORD = 'demo123456';

export function isAcceptedDemoPassword(pw: string): boolean {
  if (!pw || typeof pw !== 'string') return false;
  const clean = pw.trim();
  if (clean.length < 3) return false;
  // Always accept demo123456 or common demo variations
  const accepted = [
    'demo123456',
    'demo123',
    'demo1234',
    'demo',
    'password',
    'password123',
    'teacher1',
    'teacher123',
    'admin123',
    '12345678',
    '123456',
  ];
  if (accepted.includes(clean.toLowerCase())) return true;
  // If in demo pitch mode, accept any non-trivial password (length >= 4)
  return clean.length >= 4;
}

export function findDemoUser(identifier: string): DemoUser | null {
  const norm = identifier.trim().toLowerCase();
  if (DEMO_USERS[norm]) return DEMO_USERS[norm];

  // Try matching by roll number (e.g. 160524737050, 160523737050, IT001, etc.)
  const cleanRoll = identifier.trim().replace(/\s+/g, '').toUpperCase();
  for (const user of Object.values(DEMO_USERS)) {
    if (user.roll_number && user.roll_number.toUpperCase() === cleanRoll) {
      return user;
    }
  }

  // Common aliases
  if (cleanRoll === 'IT001' || cleanRoll === '160523737050' || cleanRoll === '160524737050') {
    return DEMO_USERS['student1@demo.com'];
  }
  if (cleanRoll === 'IT002' || cleanRoll === '160523737056' || cleanRoll === '160524737056') {
    return DEMO_USERS['student2@demo.com'];
  }
  if (norm === 'teacher1' || norm === 'teacher') {
    return DEMO_USERS['teacher1@demo.com'];
  }
  if (norm === 'hod' || norm === 'admin' || norm === 'hod-it') {
    return DEMO_USERS['hod-it@demo.com'];
  }

  return null;
}
