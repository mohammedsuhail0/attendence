qacfrom pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib import colors

md_path = Path(__file__).resolve().with_name("SMART_ATTENDANCE_PATENT_DISCLOSURE.md")
pdf_path = md_path.with_suffix('.pdf')

text = md_path.read_text(encoding="utf-8")
lines = text.splitlines()

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "TitleCustom",
    parent=styles["Title"],
    fontSize=19,
    leading=23,
    textColor=colors.HexColor("#0f172a"),
    spaceAfter=8,
)
h1_style = ParagraphStyle(
    "H1",
    parent=styles["Heading1"],
    fontSize=14,
    leading=18,
    textColor=colors.HexColor("#0f172a"),
    spaceBefore=8,
    spaceAfter=5,
)
h2_style = ParagraphStyle(
    "H2",
    parent=styles["Heading2"],
    fontSize=11.5,
    leading=15,
    textColor=colors.HexColor("#1e293b"),
    spaceBefore=5,
    spaceAfter=3,
)
body_style = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontSize=10.3,
    leading=13.8,
    textColor=colors.HexColor("#111827"),
    spaceAfter=2,
)
list_style = ParagraphStyle(
    "List",
    parent=body_style,
    leftIndent=10,
    bulletIndent=2,
)

story = []
for raw in lines:
    line = raw.strip()
    if not line:
        story.append(Spacer(1, 3))
        continue

    safe = (
        line.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )

    if line.startswith("# "):
        story.append(Paragraph(safe[2:].strip(), title_style))
    elif line.startswith("## "):
        story.append(Paragraph(safe[3:].strip(), h1_style))
    elif line.startswith("### "):
        story.append(Paragraph(safe[4:].strip(), h2_style))
    elif line.startswith("- "):
        story.append(Paragraph(f"• {safe[2:].strip()}", list_style))
    elif len(line) > 3 and line[0].isdigit() and line[1] == "." and line[2] == " ":
        story.append(Paragraph(safe, list_style))
    else:
        story.append(Paragraph(safe, body_style))

doc = SimpleDocTemplate(
    str(pdf_path),
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=14 * mm,
    bottomMargin=14 * mm,
    title="Smart Attendance Patent Technical Disclosure",
)
doc.build(story)
print("PDF_OK")
