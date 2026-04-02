import fs from "node:fs";
import path from "node:path";

const STUDENTS_CSV = "supabase/students_it_clean.csv";
const FACE_DIR = "data/photo-extract/faces";
const OUTPUT_DIR = "data/photo-extract/mapped/by_roll";
const OUTPUT_CSV = "data/photo-extract/photo-enrollment-manifest.csv";
const OUTPUT_JSON = "data/photo-extract/photo-enrollment-manifest.json";
const TARGET_ROLL_PREFIX = "160524737";
const SOURCE_SUFFIX_OVERRIDES = {
  // No longer needed: shifts are handled computationally below.
};

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const rows = text.split(/\r?\n/);
  const headers = rows[0].split(",");
  return rows.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = cols[i] ?? "";
    }
    return row;
  });
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sortFaceFiles(faceFiles) {
  return [...faceFiles].sort((a, b) => {
    const ai = Number(a.match(/\d+/)?.[0] || "0");
    const bi = Number(b.match(/\d+/)?.[0] || "0");
    return ai - bi;
  });
}

function sortStudents(students) {
  return [...students].sort((a, b) => {
    const ai = Number(a.roll_suffix || "0");
    const bi = Number(b.roll_suffix || "0");
    return ai - bi;
  });
}

function main() {
  const students = parseCsv(STUDENTS_CSV);
  const mappedStudents = sortStudents(
    students.filter((row) => row.roll_number.startsWith(TARGET_ROLL_PREFIX))
  );
  const unmappedStudents = sortStudents(
    students.filter((row) => !row.roll_number.startsWith(TARGET_ROLL_PREFIX))
  );

  const faceFiles = sortFaceFiles(
    fs
      .readdirSync(FACE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^student_\d+\.png$/i.test(entry.name))
      .map((entry) => entry.name)
  );
  const availableFaceSet = new Set(faceFiles);

  ensureDir(OUTPUT_DIR);

  const records = [];
  const usedFaces = new Set();
  for (const student of mappedStudents) {
    let sourceSuffix = SOURCE_SUFFIX_OVERRIDES[student.roll_suffix] || student.roll_suffix;
    const rollSuffixNum = parseInt(student.roll_suffix, 10);
    
    // Student 160524737045 didn't have a photo in the source PDF.
    if (rollSuffixNum === 45) {
      sourceSuffix = "MISSING_PHOTO_DELIBERATE";
    } else if (rollSuffixNum > 45) {
      // Due to missing photo for 45, all extracted indices from 45 onwards are shifted down.
      // So student 046 gets image student_045.png
      sourceSuffix = String(rollSuffixNum - 1).padStart(3, '0');
    }

    const sourceFile = `student_${sourceSuffix}.png`;
    if (!availableFaceSet.has(sourceFile) || sourceSuffix === "MISSING_PHOTO_DELIBERATE") {
      records.push({
        roll_number: student.roll_number,
        roll_suffix: student.roll_suffix,
        student_name: student.student_name,
        department: student.department,
        section: student.section,
        email: student.email,
        source_face_file: "",
        mapped_face_file: "",
        mapped_face_path: "",
        status: "missing_photo",
      });
      continue;
    }

    const targetFile = `${student.roll_number}.png`;
    fs.copyFileSync(path.join(FACE_DIR, sourceFile), path.join(OUTPUT_DIR, targetFile));
    usedFaces.add(sourceFile);

    records.push({
      roll_number: student.roll_number,
      roll_suffix: student.roll_suffix,
      student_name: student.student_name,
      department: student.department,
      section: student.section,
      email: student.email,
      source_face_file: sourceFile,
      mapped_face_file: targetFile,
      mapped_face_path: path.posix.join("data/photo-extract/mapped/by_roll", targetFile),
      status: "mapped",
    });
  }

  const remainingFaces = faceFiles.filter((sourceFile) => !usedFaces.has(sourceFile));
  for (const sourceFile of remainingFaces) {
    records.push({
      roll_number: "",
      roll_suffix: "",
      student_name: "",
      department: "",
      section: "",
      email: "",
      source_face_file: sourceFile,
      mapped_face_file: "",
      mapped_face_path: "",
      status: "unassigned_face",
    });
  }

  for (const student of unmappedStudents) {
    records.push({
      roll_number: student.roll_number,
      roll_suffix: student.roll_suffix,
      student_name: student.student_name,
      department: student.department,
      section: student.section,
      email: student.email,
      source_face_file: "",
      mapped_face_file: "",
      mapped_face_path: "",
      status: "missing_photo",
    });
  }

  const csvHeaders = [
    "roll_number",
    "roll_suffix",
    "student_name",
    "department",
    "section",
    "email",
    "source_face_file",
    "mapped_face_file",
    "mapped_face_path",
    "status",
  ];

  fs.writeFileSync(OUTPUT_CSV, toCsv(records, csvHeaders), "utf8");

  const payload = {
    generated_at: new Date().toISOString(),
    total_students_in_csv: students.length,
    mapped_students_count: mappedStudents.length,
    face_images_count: faceFiles.length,
    consumed_face_images_count: usedFaces.size,
    unassigned_face_images_count: remainingFaces.length,
    missing_photo_count: unmappedStudents.length,
    target_roll_prefix: TARGET_ROLL_PREFIX,
    output_dir: OUTPUT_DIR,
    records,
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        mapped: mappedStudents.length,
        missing_photo: unmappedStudents.length,
        output_csv: OUTPUT_CSV,
        output_json: OUTPUT_JSON,
        output_dir: OUTPUT_DIR,
      },
      null,
      2
    )
  );
}

main();
