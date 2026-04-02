import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file = ".env.local") {
  const out = {};
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function parseCsv(path) {
  const rows = fs.readFileSync(path, "utf8").trim().split(/\r?\n/);
  const headers = rows[0].split(",");
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  return rows.slice(1).map((row) => {
    const cols = row.split(",");
    return {
      roll_number: cols[idx.roll_number],
      student_name: cols[idx.student_name],
      department: cols[idx.department],
      section: cols[idx.section] === "A" ? "1" : cols[idx.section],
      email: cols[idx.email],
      default_password: cols[idx.default_password] || "demo123456",
    };
  });
}

const classCatalog = [
  ["IT", "1", "Programming Fundamentals"],
  ["IT", "1", "Digital Logic"],
  ["IT", "1", "Mathematics I"],
  ["IT", "2", "Data Structures"],
  ["IT", "2", "DBMS"],
  ["IT", "2", "Operating Systems"],
  ["IT", "3", "Computer Networks"],
  ["IT", "3", "Software Engineering"],
  ["IT", "3", "Web Technology"],
  ["IT", "4", "Cloud Computing"],
  ["IT", "4", "Information Security"],
  ["IT", "4", "AI Fundamentals"],
  ["CSE", "1", "Engineering Mathematics"],
  ["CSE", "1", "Problem Solving in C"],
  ["CSE", "1", "Physics for Computing"],
  ["CSE", "2", "Data Structures"],
  ["CSE", "2", "Object Oriented Programming"],
  ["CSE", "2", "DBMS"],
  ["CSE", "3", "Computer Networks"],
  ["CSE", "3", "Design and Analysis of Algorithms"],
  ["CSE", "3", "Operating Systems"],
  ["CSE", "4", "Machine Learning"],
  ["CSE", "4", "Compiler Design"],
  ["CSE", "4", "Cloud Computing"],
  ["AIDS", "1", "Statistics for AI"],
  ["AIDS", "1", "Python Programming"],
  ["AIDS", "1", "Linear Algebra"],
  ["AIDS", "2", "Data Structures"],
  ["AIDS", "2", "Probability and Statistics"],
  ["AIDS", "2", "DBMS"],
  ["AIDS", "3", "Machine Learning"],
  ["AIDS", "3", "Data Mining"],
  ["AIDS", "3", "Deep Learning Basics"],
  ["AIDS", "4", "NLP"],
  ["AIDS", "4", "Computer Vision"],
  ["AIDS", "4", "Big Data Analytics"],
  ["Civil", "1", "Engineering Mechanics"],
  ["Civil", "1", "Engineering Drawing"],
  ["Civil", "1", "Mathematics I"],
  ["Civil", "2", "Surveying"],
  ["Civil", "2", "Strength of Materials"],
  ["Civil", "2", "Fluid Mechanics"],
  ["Civil", "3", "Structural Analysis"],
  ["Civil", "3", "Geotechnical Engineering"],
  ["Civil", "3", "Transportation Engineering"],
  ["Civil", "4", "Environmental Engineering"],
  ["Civil", "4", "Construction Management"],
  ["Civil", "4", "Design of Structures"],
  ["Mech", "1", "Engineering Graphics"],
  ["Mech", "1", "Basic Thermodynamics"],
  ["Mech", "1", "Workshop Technology"],
  ["Mech", "2", "Fluid Mechanics"],
  ["Mech", "2", "Materials Science"],
  ["Mech", "2", "Manufacturing Processes"],
  ["Mech", "3", "Heat Transfer"],
  ["Mech", "3", "Theory of Machines"],
  ["Mech", "3", "Machine Design"],
  ["Mech", "4", "CAD/CAM"],
  ["Mech", "4", "Automobile Engineering"],
  ["Mech", "4", "Industrial Engineering"],
];

async function createAuthUser(supabase, { email, password, role, full_name }) {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, full_name },
  });
  if (!error) return { created: true };
  if (String(error.message).toLowerCase().includes("already")) return { created: false };
  throw new Error(`${email}: ${error.message}`);
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const supabase = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const students = parseCsv("supabase/students_it_clean.csv");
  const teachers = [
    { email: "teacher1@demo.com", full_name: "Dr. Sharma" },
    { email: "teacher2@demo.com", full_name: "Prof. Kumar" },
  ];

  let createdStudents = 0;
  let existingStudents = 0;

  for (const s of students) {
    const res = await createAuthUser(supabase, {
      email: s.email,
      password: s.default_password,
      role: "student",
      full_name: s.student_name,
    });
    if (res.created) createdStudents++;
    else existingStudents++;
  }

  for (const t of teachers) {
    await createAuthUser(supabase, {
      email: t.email,
      password: "demo123456",
      role: "teacher",
      full_name: t.full_name,
    });
  }

  // Backfill missing profile rows in case trigger failed earlier
  const authEmails = [
    ...students.map((s) => s.email),
    ...teachers.map((t) => t.email),
  ];
  const { data: authUsersPage, error: authListErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authListErr) throw new Error(`auth list failed: ${authListErr.message}`);
  const authUsers = (authUsersPage?.users || []).filter((u) => authEmails.includes(u.email || ""));

  const { data: existingProfiles, error: existingProfilesErr } = await supabase
    .from("profiles")
    .select("id, email")
    .in("email", authEmails);
  if (existingProfilesErr) throw new Error(`existing profiles fetch failed: ${existingProfilesErr.message}`);
  const existingProfileIds = new Set((existingProfiles || []).map((p) => p.id));

  const profilesToInsert = authUsers
    .filter((u) => !existingProfileIds.has(u.id))
    .map((u) => ({
      id: u.id,
      email: u.email || "",
      full_name: (u.user_metadata?.full_name || "").toString(),
      role:
        (u.user_metadata?.role || "student") === "teacher"
          ? "teacher"
          : "student",
    }));

  if (profilesToInsert.length) {
    const { error: insertProfilesErr } = await supabase.from("profiles").insert(profilesToInsert);
    if (insertProfilesErr) {
      throw new Error(`profiles backfill failed: ${insertProfilesErr.message}`);
    }
  }

  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, email, role")
    .in("email", [
      ...students.map((s) => s.email),
      ...teachers.map((t) => t.email),
    ]);
  if (profilesErr) throw new Error(`profiles fetch failed: ${profilesErr.message}`);

  const profileByEmail = new Map(profiles.map((p) => [p.email, p]));

  for (const s of students) {
    const p = profileByEmail.get(s.email);
    if (!p) continue;
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: s.student_name,
        department: s.department,
        section: s.section,
        roll_number: s.roll_number,
      })
      .eq("id", p.id);
    if (error) throw new Error(`profile update failed for ${s.email}: ${error.message}`);
  }

  for (const t of teachers) {
    const p = profileByEmail.get(t.email);
    if (!p) continue;
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: t.full_name,
        department: "IT",
        section: "1",
      })
      .eq("id", p.id);
    if (error) throw new Error(`teacher update failed for ${t.email}: ${error.message}`);
  }

  const teacher1 = profileByEmail.get("teacher1@demo.com");
  const teacher2 = profileByEmail.get("teacher2@demo.com");
  if (!teacher1 || !teacher2) {
    throw new Error("Teacher profiles missing. Check auth user creation.");
  }

  const classesToUpsert = classCatalog.map(([department, section, subject]) => ({
    department,
    section,
    subject,
    teacher_id: teacher1.id,
  }));

  const { error: classErr } = await supabase
    .from("classes")
    .upsert(classesToUpsert, { onConflict: "department,section,subject" });
  if (classErr) throw new Error(`class upsert failed: ${classErr.message}`);

  const { data: classRows, error: classFetchErr } = await supabase
    .from("classes")
    .select("id, department, section")
    .eq("department", "IT")
    .eq("section", "1");
  if (classFetchErr) throw new Error(`class fetch failed: ${classFetchErr.message}`);

  const studentProfileIds = students
    .map((s) => profileByEmail.get(s.email)?.id)
    .filter(Boolean);

  const enrollRows = [];
  for (const sid of studentProfileIds) {
    for (const c of classRows) {
      enrollRows.push({ student_id: sid, class_id: c.id });
    }
  }

  if (enrollRows.length) {
    const { error: enrollErr } = await supabase
      .from("enrollments")
      .upsert(enrollRows, { onConflict: "student_id,class_id" });
    if (enrollErr) throw new Error(`enrollment upsert failed: ${enrollErr.message}`);
  }

  console.log(
    JSON.stringify(
      {
        createdStudents,
        existingStudents,
        totalStudents: students.length,
        classes: classesToUpsert.length,
        enrollments: enrollRows.length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
