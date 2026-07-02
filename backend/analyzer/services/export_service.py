"""
export_service.py
─────────────────────────────────────────────────────────────────────────────
Builds a one-click downloadable report (Markdown or PDF) from a completed
RepositoryAnalysis row, summarising the same data the dashboard tabs show
(scores, security findings, architecture, dependencies, structure, detected
patterns, recommendations) into a single shareable document.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

# ──────────────────────────────────────────────────────────────────────────
# Grade labels — meaningful text instead of bare letters
# ──────────────────────────────────────────────────────────────────────────

GRADE_LABELS = {
    "A": "Excellent",
    "B": "Good",
    "C": "Fair",
    "D": "Needs Improvement",
    "F": "Critical",
}

GRADE_COLORS = {
    "A": colors.HexColor("#16a34a"),
    "B": colors.HexColor("#65a30d"),
    "C": colors.HexColor("#f59e0b"),
    "D": colors.HexColor("#f97316"),
    "F": colors.HexColor("#ef4444"),
}
SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}


def _grade_label(letter: str) -> str:
    """Return a human-readable label for a letter grade, e.g. 'B (Good)'."""
    if not letter or letter == "—":
        return "—"
    label = GRADE_LABELS.get(letter.strip().upper())
    return f"{letter} ({label})" if label else letter


def _fmt_date(value: str) -> str:
    if not value:
        return "—"
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%b %d, %Y %H:%M UTC")
    except Exception:
        return str(value)


def _flatten_file_tree(node: dict, prefix: str = "", lines: list[str] | None = None, depth: int = 0) -> list[str]:
    """Flatten a nested file_tree dict/list structure into indented path lines."""
    if lines is None:
        lines = []
    if node is None:
        return lines

    # Support both {"name":..., "type":"folder"/"file", "children":[...]} and
    # a flat list of such nodes.
    if isinstance(node, list):
        for child in node:
            _flatten_file_tree(child, prefix, lines, depth)
        return lines

    if isinstance(node, dict):
        name = node.get("name") or node.get("path") or ""
        is_dir = node.get("type") == "folder" or "children" in node
        indent = "  " * depth
        if name:
            lines.append(f"{indent}{'📁' if is_dir else '📄'} {name}{'/' if is_dir else ''}")
        for child in (node.get("children") or []):
            _flatten_file_tree(child, prefix, lines, depth + 1)
    return lines


# ──────────────────────────────────────────────────────────────────────────
# Markdown
# ──────────────────────────────────────────────────────────────────────────

def build_markdown_report(analysis) -> str:
    m: dict[str, Any] = analysis.metadata or {}
    quality = m.get("quality") or {}
    security = m.get("security") or {}
    architecture = m.get("architecture") or {}
    dependencies = m.get("dependencies") or {}
    predictions = m.get("predictions") or {}
    file_tree = m.get("file_tree")
    creator = (
        m.get("creator")
        or m.get("owner")
        or m.get("author")
        or getattr(analysis, "created_by", None)
        or getattr(analysis, "owner_name", None)
        or "—"
    )

    lines: list[str] = []
    add = lines.append

    add(f"# Analysis Report — {analysis.project_name or 'Repository'}")
    add("")
    add(f"**Repository:** {analysis.repo_url}")
    add(f"**Branch:** {analysis.branch or '(default)'}")
    add(f"**Creator:** {creator}")
    add(f"**Analyzed:** {_fmt_date(analysis.completed_at or analysis.created_at)}")
    add(f"**Files scanned:** {analysis.file_count or 0} files across {analysis.folder_count or 0} folders")
    add("")
    add("---")
    add("")

    # Scores
    add("## Scores")
    add("")
    add("| Metric | Score | Rating |")
    add("|---|---|---|")
    add(f"| Overall | {m.get('composite_score', 0):.0f}/100 | {_grade_label(m.get('composite_grade', '—'))} |")
    add(f"| Code Quality | {quality.get('overall_score', 0):.0f}/100 | {_grade_label(quality.get('overall_grade', '—'))} |")
    add(f"| Security | {security.get('risk_score', 0):.0f}/100 risk | {_grade_label(security.get('risk_grade', '—'))} |")
    add(f"| Dependencies | {dependencies.get('health_score', 0):.0f}/100 | {_grade_label(dependencies.get('grade', '—'))} |")
    add("")

    # Quality dimensions
    dims = quality.get("dimensions") or []
    if dims:
        add("## Code Quality Breakdown")
        add("")
        for d in dims:
            add(f"- **{d.get('name', 'Dimension')}** — {d.get('score', 0):.0f}/100 ({_grade_label(d.get('grade', '—'))})")
            for f in (d.get("findings") or [])[:3]:
                add(f"  - {f}")
        add("")

    # Security findings (already grouped upstream by rule with occurrence counts)
    findings = sorted(
        security.get("findings") or [],
        key=lambda f: SEVERITY_ORDER.get(f.get("severity", ""), 9),
    )
    if findings:
        add("## Security Findings")
        add("")
        for f in findings[:25]:
            occ = f.get("occurrences", 1)
            occ_label = f" ({occ} occurrences)" if occ > 1 else ""
            add(f"- **[{f.get('severity', '?')}] {f.get('title', 'Finding')}**{occ_label}")
            if f.get("description"):
                add(f"  {f['description']}")
            if f.get("file_path"):
                loc = f["file_path"] + (f":{f['line']}" if f.get("line") else "")
                add(f"  `{loc}`")
        if len(findings) > 25:
            add(f"- … and {len(findings) - 25} more findings")
        add("")

    # Architecture
    if architecture:
        add("## Architecture")
        add("")
        if architecture.get("confidence") is not None:
            add(f"**Detection confidence:** {architecture['confidence']:.0f}%")
            add("")
        for label, key in [
            ("Frontend", "frontend"), ("Backend", "backend"), ("Databases", "databases"),
            ("Authentication", "authentication"), ("Infrastructure", "infrastructure"),
            ("CI/CD", "cicd"),
        ]:
            items = architecture.get(key) or []
            if items:
                add(f"- **{label}:** {', '.join(items)}")
        add("")

    # Detected Patterns (with confidence — previously missing from export)
    patterns = architecture.get("architecture_patterns") or predictions.get("patterns") or []
    if patterns:
        add("## Detected Patterns")
        add("")
        for p in patterns:
            name = p.get("pattern") or p.get("name") or p.get("title") or "Pattern"
            conf = p.get("confidence")
            conf_label = f" — {conf:.0f}% confidence" if conf is not None else ""
            add(f"- **{name}**{conf_label}")
            evidence = p.get("evidence") or p.get("description")
            if evidence:
                add(f"  {evidence}")
        add("")

    # Project Structure (file tree — previously missing from export)
    if file_tree:
        add("## Project Structure")
        add("")
        add("```")
        tree_lines = _flatten_file_tree(file_tree)
        add("\n".join(tree_lines) if tree_lines else "(structure unavailable)")
        add("```")
        add("")

    # Dependencies
    eco = dependencies.get("ecosystems") or []
    if eco or dependencies.get("total_dependencies") is not None:
        add("## Dependencies")
        add("")
        add(f"Total: {dependencies.get('total_dependencies', 0)} "
            f"({dependencies.get('pinned_count', 0)} pinned, "
            f"{dependencies.get('unpinned_count', 0)} unpinned, "
            f"{dependencies.get('flagged_count', 0)} flagged)")
        add("")
        for e in eco:
            eco_name = e.get("name") or e.get("ecosystem") or "Ecosystem"
            add(f"### {eco_name}")
            for pkg in (e.get("packages") or e.get("dependencies") or [])[:50]:
                pname = pkg.get("name", "package")
                pver = pkg.get("version", "")
                flag = " ⚠️" if pkg.get("flagged") else ""
                add(f"- {pname} `{pver}`{flag}")
            add("")

    # Recommendations
    recs = (architecture.get("recommendations") or []) + (dependencies.get("recommendations") or [])
    if recs:
        add("## Recommendations")
        add("")
        for r in recs[:15]:
            add(f"- {r}")
        add("")

    # Predictions / Outlook
    if predictions.get("trajectory_summary"):
        add("## Outlook")
        add("")
        add(f"**Trajectory:** {predictions.get('overall_trajectory', 'NEUTRAL')}")
        add("")
        add(predictions["trajectory_summary"])
        add("")

    add("---")
    add(f"*Generated by AI Engineer Studio on {datetime.now().strftime('%b %d, %Y %H:%M')}*")

    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# PDF
# ──────────────────────────────────────────────────────────────────────────

def _styles():
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(
        "ReportTitle", parent=base["Title"], fontSize=20, spaceAfter=4,
    ))
    base.add(ParagraphStyle(
        "ReportMeta", parent=base["Normal"], fontSize=9.5,
        textColor=colors.HexColor("#6b7280"), spaceAfter=2,
    ))
    base.add(ParagraphStyle(
        "SectionHeading", parent=base["Heading2"], fontSize=14,
        spaceBefore=16, spaceAfter=8, textColor=colors.HexColor("#1f2937"),
    ))
    base.add(ParagraphStyle(
        "SubHeading", parent=base["Heading3"], fontSize=11,
        spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#374151"),
    ))
    base.add(ParagraphStyle(
        "Finding", parent=base["Normal"], fontSize=9.5, spaceAfter=5, leading=13,
    ))
    base.add(ParagraphStyle(
        "Mono", parent=base["Normal"], fontName="Courier", fontSize=8,
        leading=11, textColor=colors.HexColor("#374151"),
    ))
    return base


def build_pdf_report(analysis) -> bytes:
    m: dict[str, Any] = analysis.metadata or {}
    quality = m.get("quality") or {}
    security = m.get("security") or {}
    architecture = m.get("architecture") or {}
    dependencies = m.get("dependencies") or {}
    predictions = m.get("predictions") or {}
    file_tree = m.get("file_tree")
    creator = (
        m.get("creator")
        or m.get("owner")
        or m.get("author")
        or getattr(analysis, "created_by", None)
        or getattr(analysis, "owner_name", None)
        or "—"
    )

    styles = _styles()
    story: list = []

    story.append(Paragraph(analysis.project_name or "Repository Analysis", styles["ReportTitle"]))
    story.append(Paragraph(analysis.repo_url, styles["ReportMeta"]))
    story.append(Paragraph(
        f"Branch: {analysis.branch or '(default)'} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Creator: {creator} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Analyzed: {_fmt_date(analysis.completed_at or analysis.created_at)} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"{analysis.file_count or 0} files / {analysis.folder_count or 0} folders",
        styles["ReportMeta"],
    ))
    story.append(Spacer(1, 0.5 * cm))

    # Scores table
    score_rows = [["Metric", "Score", "Rating"]]
    score_data = [
        ("Overall", m.get("composite_score", 0), m.get("composite_grade", "—")),
        ("Code Quality", quality.get("overall_score", 0), quality.get("overall_grade", "—")),
        ("Security Risk", security.get("risk_score", 0), security.get("risk_grade", "—")),
        ("Dependencies", dependencies.get("health_score", 0), dependencies.get("grade", "—")),
    ]
    for label, score, grade in score_data:
        score_rows.append([label, f"{score:.0f}/100", _grade_label(grade)])

    score_table = Table(score_rows, colWidths=[6 * cm, 3.5 * cm, 5.5 * cm])
    table_style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8f9fb")]),
    ]
    for i, (_, _, grade) in enumerate(score_data, start=1):
        c = GRADE_COLORS.get(grade, colors.HexColor("#6b7280"))
        table_style.append(("TEXTCOLOR", (2, i), (2, i), c))
        table_style.append(("FONTNAME", (2, i), (2, i), "Helvetica-Bold"))
    score_table.setStyle(TableStyle(table_style))
    story.append(score_table)

    # Security findings
    findings = sorted(
        security.get("findings") or [],
        key=lambda f: SEVERITY_ORDER.get(f.get("severity", ""), 9),
    )
    if findings:
        story.append(Paragraph("Security Findings", styles["SectionHeading"]))
        for f in findings[:20]:
            occ = f.get("occurrences", 1)
            occ_label = f" — {occ} occurrences" if occ > 1 else ""
            color = GRADE_COLORS.get(
                {"CRITICAL": "F", "HIGH": "D", "MEDIUM": "C", "LOW": "B", "INFO": "A"}.get(f.get("severity", ""), "A"),
                colors.HexColor("#6b7280"),
            )
            story.append(Paragraph(
                f'<font color="{color.hexval()}"><b>[{f.get("severity", "?")}]</b></font> '
                f'<b>{f.get("title", "Finding")}</b>{occ_label}<br/>'
                f'<font size="8.5" color="#6b7280">{f.get("description", "")}</font>',
                styles["Finding"],
            ))
        if len(findings) > 20:
            story.append(Paragraph(f"… and {len(findings) - 20} more findings", styles["Finding"]))

    # Architecture
    arch_lines = []
    for label, key in [
        ("Frontend", "frontend"), ("Backend", "backend"), ("Databases", "databases"),
        ("Authentication", "authentication"), ("Infrastructure", "infrastructure"), ("CI/CD", "cicd"),
    ]:
        items = architecture.get(key) or []
        if items:
            arch_lines.append(f"<b>{label}:</b> {', '.join(items)}")
    if arch_lines or architecture.get("confidence") is not None:
        story.append(Paragraph("Architecture", styles["SectionHeading"]))
        if architecture.get("confidence") is not None:
            story.append(Paragraph(
                f"<b>Detection confidence:</b> {architecture['confidence']:.0f}%", styles["Finding"]
            ))
        for line in arch_lines:
            story.append(Paragraph(line, styles["Finding"]))

    # Detected Patterns
    patterns = architecture.get("architecture_patterns") or predictions.get("patterns") or []
    if patterns:
        story.append(Paragraph("Detected Patterns", styles["SectionHeading"]))
        for p in patterns:
            name = p.get("pattern") or p.get("name") or p.get("title") or "Pattern"
            conf = p.get("confidence")
            conf_label = f' &nbsp;<font color="#4f7ef8"><b>{conf:.0f}% confidence</b></font>' if conf is not None else ""
            story.append(Paragraph(f"<b>{name}</b>{conf_label}", styles["Finding"]))
            evidence = p.get("evidence") or p.get("description")
            if evidence:
                story.append(Paragraph(
                    f'<font size="8.5" color="#6b7280">{evidence}</font>', styles["Finding"]
                ))

    # Project Structure
    if file_tree:
        story.append(Paragraph("Project Structure", styles["SectionHeading"]))
        tree_lines = _flatten_file_tree(file_tree)[:150]
        for line in tree_lines:
            story.append(Paragraph(line.replace(" ", "&nbsp;"), styles["Mono"]))
        if len(_flatten_file_tree(file_tree)) > 150:
            story.append(Paragraph("… (truncated — see full structure in-app)", styles["Finding"]))

    # Dependencies
    eco = dependencies.get("ecosystems") or []
    if eco:
        story.append(Paragraph("Dependencies", styles["SectionHeading"]))
        story.append(Paragraph(
            f"Total: {dependencies.get('total_dependencies', 0)} "
            f"({dependencies.get('pinned_count', 0)} pinned, "
            f"{dependencies.get('unpinned_count', 0)} unpinned, "
            f"{dependencies.get('flagged_count', 0)} flagged)",
            styles["Finding"],
        ))
        for e in eco:
            eco_name = e.get("name") or e.get("ecosystem") or "Ecosystem"
            story.append(Paragraph(eco_name, styles["SubHeading"]))
            pkg_lines = []
            for pkg in (e.get("packages") or e.get("dependencies") or [])[:40]:
                flag = " ⚠️" if pkg.get("flagged") else ""
                pkg_lines.append(f"{pkg.get('name','package')} {pkg.get('version','')}{flag}")
            if pkg_lines:
                story.append(Paragraph(" &nbsp;•&nbsp; ".join(pkg_lines), styles["Finding"]))

    # Recommendations
    recs = (architecture.get("recommendations") or []) + (dependencies.get("recommendations") or [])
    if recs:
        story.append(Paragraph("Recommendations", styles["SectionHeading"]))
        for r in recs[:15]:
            story.append(Paragraph(f"• {r}", styles["Finding"]))

    story.append(Spacer(1, 1 * cm))
    story.append(Paragraph(
        f"Generated by AI Engineer Studio on {datetime.now().strftime('%b %d, %Y %H:%M')}",
        ParagraphStyle("Footer", parent=styles["Normal"], fontSize=8,
                       textColor=colors.HexColor("#9ca3af"), alignment=TA_CENTER),
    ))

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
    )
    doc.build(story)
    return buffer.getvalue()
