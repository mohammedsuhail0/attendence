import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  addStudentToDepartment,
  getDepartmentStudentsMonthlySummary,
} from '@/lib/admin-students';
import { getMonthKeyInTimeZone } from '@/lib/utils';

const Years = ['1', '2', '3', '4'] as const;

const ListStudentsSchema = z.object({
  year: z.enum(Years),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const AddStudentSchema = z.object({
  roll_number: z.string().trim().min(1),
  full_name: z.string().trim().min(1),
  year: z.enum(Years),
  password: z.string().min(8).default('demo123456'),
  email: z.string().email().optional(),
});

async function getAdminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized', status: 401 as const };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, department, full_name')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return { error: 'Profile not found', status: 404 as const };
  }

  if (profile.role !== 'admin') {
    return { error: 'Forbidden', status: 403 as const };
  }

  if (!profile.department) {
    return { error: 'Admin department is not configured', status: 400 as const };
  }

  return {
    context: {
      userId: user.id,
      department: profile.department,
      fullName: profile.full_name || 'Admin',
    },
  };
}

export async function GET(request: Request) {
  try {
    const adminCtx = await getAdminContext();
    if ('error' in adminCtx) {
      return NextResponse.json({ error: adminCtx.error }, { status: adminCtx.status });
    }

    const { searchParams } = new URL(request.url);
    const parsed = ListStudentsSchema.safeParse({
      year: searchParams.get('year') || '1',
      month: searchParams.get('month') || getMonthKeyInTimeZone(),
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 });
    }

    const students = await getDepartmentStudentsMonthlySummary({
      department: adminCtx.context.department,
      year: parsed.data.year,
      month: parsed.data.month,
    });

    return NextResponse.json({
      department: adminCtx.context.department,
      admin_name: adminCtx.context.fullName,
      year: parsed.data.year,
      month: parsed.data.month,
      students,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCtx = await getAdminContext();
    if ('error' in adminCtx) {
      return NextResponse.json({ error: adminCtx.error }, { status: adminCtx.status });
    }

    const parsed = AddStudentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const student = await addStudentToDepartment({
      department: adminCtx.context.department,
      year: parsed.data.year,
      rollNumber: parsed.data.roll_number,
      fullName: parsed.data.full_name,
      password: parsed.data.password,
      email: parsed.data.email,
    });

    return NextResponse.json({
      message: 'Student added successfully',
      student,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status =
      message.toLowerCase().includes('exists') ||
      message.toLowerCase().includes('already')
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
