import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getDepartmentStudentsMonthlySummary } from '@/lib/admin-students';
import { getMonthKeyInTimeZone } from '@/lib/utils';

const Years = ['1', '2', '3', '4'] as const;

const ExportSchema = z.object({
  year: z.enum(Years),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

function csvEscape(value: string | number) {
  const asText = String(value ?? '');
  if (!/[",\n]/.test(asText)) return asText;
  return `"${asText.replace(/"/g, '""')}"`;
}

function toCsv(
  rows: {
    slno: number;
    roll_number: string;
    full_name: string;
    attendance_percentage: number;
    total_attendance: number;
    total_sessions: number;
  }[]
) {
  const header = [
    'slno',
    'rollno',
    'name',
    'attendance_percentage_of_month',
    'present_count',
    'total_classes_in_month',
  ];
  const lines = rows.map((row) =>
    [
      row.slno,
      row.roll_number,
      row.full_name,
      row.attendance_percentage.toFixed(2),
      row.total_attendance,
      row.total_sessions,
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

async function getAdminDepartment() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized', status: 401 as const };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, department')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return { error: 'Profile not found', status: 404 as const };
  if (profile.role !== 'admin') return { error: 'Forbidden', status: 403 as const };
  if (!profile.department) return { error: 'Admin department is not configured', status: 400 as const };

  return { department: profile.department };
}

export async function GET(request: Request) {
  try {
    const admin = await getAdminDepartment();
    if ('error' in admin) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const { searchParams } = new URL(request.url);
    const parsed = ExportSchema.safeParse({
      year: searchParams.get('year') || '1',
      month: searchParams.get('month') || getMonthKeyInTimeZone(),
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 });
    }

    const rows = await getDepartmentStudentsMonthlySummary({
      department: admin.department,
      year: parsed.data.year,
      month: parsed.data.month,
    });

    const csv = toCsv(rows);
    const filename = `students-${admin.department}-${parsed.data.year}-${parsed.data.month}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
