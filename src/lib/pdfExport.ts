import { jsPDF } from 'jspdf';
import type { VillageTask } from '../types/village';

export function exportTaskReportAsPdf(task: VillageTask) {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
  });

  const margin = 52;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;
  let y = 58;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 88, 'F');

  doc.setTextColor(251, 191, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GUILDHAVEN · EXECUTIVE REPORT', margin, 32);

  doc.setTextColor(248, 250, 252);
  doc.setFontSize(17);
  const titleLines = doc.splitTextToSize(task.prompt, maxWidth);
  doc.text(titleLines.slice(0, 2), margin, 54);

  y = 114;

  // Metadata Line
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const dateStr = new Date(task.createdAt).toLocaleString();
  const metaText = `Director: ${task.assignedDirectorName}${task.escalatedToAdvisor ? '  |  Senior Advisor Review' : ''}  |  ${dateStr}`;
  const metaLines = doc.splitTextToSize(metaText, maxWidth);
  doc.text(metaLines, margin, y);
  y += metaLines.length * 14 + 10;

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // Body Text (Cleanly formatted headings, rules, lists & prose from Markdown)
  const stripInline = (s: string) =>
    s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\*(?!\s)([^*]+?)(?<!\s)\*/g, '$1');

  const rawLines = task.reportMarkdown.replace(/\r\n/g, '\n').split('\n');

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      y += 6;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      if (y > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage();
        y = 54;
      }
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 12;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = stripInline(headingMatch[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(level === 1 ? 13.5 : level === 2 ? 12 : 11);
      doc.setTextColor(15, 23, 42);
      const wrapped = doc.splitTextToSize(headingText, maxWidth);
      if (y + wrapped.length * 16 > doc.internal.pageSize.getHeight() - 56) {
        doc.addPage();
        y = 54;
      }
      y += level === 1 ? 4 : 6;
      doc.text(wrapped, margin, y);
      y += wrapped.length * 16 + 4;
      continue;
    }

    const bulletMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    const isIndentedBullet = /^\s{2,}[-*+]\s+/.test(rawLine);
    const lineText = bulletMatch ? `•  ${stripInline(bulletMatch[1])}` : stripInline(trimmed);
    const indent = bulletMatch ? (isIndentedBullet ? 22 : 10) : 0;

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const wrapped = doc.splitTextToSize(lineText, maxWidth - indent);
    if (y + wrapped.length * 14 > doc.internal.pageSize.getHeight() - 56) {
      doc.addPage();
      y = 54;
    }
    doc.text(wrapped, margin + indent, y);
    y += wrapped.length * 14 + 4;
  }

  // Grounding Sources
  if (task.groundingSources && task.groundingSources.length > 0) {
    y += 14;
    if (y > doc.internal.pageSize.getHeight() - 90) {
      doc.addPage();
      y = 54;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Google Search Verified Sources', margin, y);
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(37, 99, 235);
    for (const src of task.groundingSources) {
      const srcLine = `${src.title} — ${src.uri}`;
      const wrappedSrc = doc.splitTextToSize(srcLine, maxWidth);
      if (y + wrappedSrc.length * 12 > doc.internal.pageSize.getHeight() - 48) {
        doc.addPage();
        y = 54;
      }
      doc.text(wrappedSrc, margin, y);
      y += wrappedSrc.length * 12 + 4;
    }
  }

  const safeSlug = task.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 42);
  doc.save(`guildhaven-report-${safeSlug || task.id}.pdf`);
}
