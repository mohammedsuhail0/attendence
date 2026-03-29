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

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !service) {
    throw new Error("Missing Supabase URL or service role key in .env.local");
  }

  const supabase = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: teacher, error: teacherError } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("role", "teacher")
    .eq("email", "teacher1@demo.com")
    .single();

  if (teacherError || !teacher) {
    throw new Error(`Teacher lookup failed: ${teacherError?.message || "teacher1@demo.com not found"}`);
  }

  const { error: migrateProfilesError } = await supabase
    .from("profiles")
    .update({ section: "1" })
    .eq("section", "A");

  if (migrateProfilesError) {
    throw new Error(`Profile migration failed: ${migrateProfilesError.message}`);
  }

  const { error: classUpsertError } = await supabase
    .from("classes")
    .upsert(
      classCatalog.map(([department, section, subject]) => ({
        department,
        section,
        subject,
        teacher_id: teacher.id,
      })),
      { onConflict: "department,section,subject" }
    );

  if (classUpsertError) {
    throw new Error(`Class catalog sync failed: ${classUpsertError.message}`);
  }

  const { data: itClasses, error: itClassesError } = await supabase
    .from("classes")
    .select("id")
    .eq("department", "IT")
    .eq("section", "1");

  if (itClassesError) {
    throw new Error(`IT class fetch failed: ${itClassesError.message}`);
  }

  const { data: itStudents, error: itStudentsError } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "student")
    .eq("department", "IT")
    .eq("section", "1");

  if (itStudentsError) {
    throw new Error(`IT student fetch failed: ${itStudentsError.message}`);
  }

  const enrollments = [];
  for (const student of itStudents ?? []) {
    for (const cls of itClasses ?? []) {
      enrollments.push({ student_id: student.id, class_id: cls.id });
    }
  }

  if (enrollments.length > 0) {
    const { error: enrollmentError } = await supabase
      .from("enrollments")
      .upsert(enrollments, { onConflict: "student_id,class_id" });

    if (enrollmentError) {
      throw new Error(`Enrollment sync failed: ${enrollmentError.message}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        teacher: teacher.email,
        catalogClasses: classCatalog.length,
        itYear1Students: itStudents?.length ?? 0,
        itYear1Classes: itClasses?.length ?? 0,
        enrollmentsCreatedOrConfirmed: enrollments.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
