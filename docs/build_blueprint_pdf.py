from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.enums import TA_LEFT

root = Path(__file__).resolve().parent
md_path = root / "SMART_ATTENDANCE_HACKATHON_BLUEPRINT.md"
pdf_path = root / "SMART_ATTENDANCE_HACKATHON_BLUEPRINT.pdf"

styles = getSampleStyleSheet()
style_h1 = ParagraphStyle(
    "H1",
    parent=styles["Heading1"],
    fontSize=18,
    leading=22,
    spaceAfter=10,
)
style_h2 = ParagraphStyle(
    "H2",
    parent=styles["Heading2"],
    fontSize=13,
    leading=16,
    spaceBefore=6,
    spaceAfter=6,
)
style_body = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontSize=10.5,
    leading=14,
    alignment=TA_LEFT,
)
style_bullet = ParagraphStyle(
    "Bullet",
    parent=style_body,
    leftIndent=14,
)


def to_html_safe(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def line_to_flowables(line: str):
    line = line.rstrip("\n")
    if not line.strip():
        return [Spacer(1, 2)]

    if line.startswith("# "):
        return [Paragraph(to_html_safe(line[2:].strip()), style_h1), Spacer(1, 3)]

    if line.startswith("## "):
        return [Paragraph(to_html_safe(line[3:].strip()), style_h2)]

    if line.startswith("### "):
        return [Paragraph(f"<b>{to_html_safe(line[4:].strip())}</b>", style_body)]

    if line.startswith("- "):
        return [Paragraph(f"• {to_html_safe(line[2:].strip())}", style_bullet)]

    stripped = line.lstrip()
    if stripped and stripped[0].isdigit() and ". " in stripped[:4]:
        return [Paragraph(to_html_safe(stripped), style_body)]

    if line.startswith("```"):
        return []

    return [Paragraph(to_html_safe(line.strip()), style_body)]


def main():
    content = md_path.read_text(encoding="utf-8").splitlines()

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Smart Attendance - Hackathon Blueprint",
        author="Smart Attendance Team",
    )

    story = []
    for line in content:
        story.extend(line_to_flowables(line))

    doc.build(story)
    print(f"PDF generated: {pdf_path}")


if __name__ == "__main__":
    main()
