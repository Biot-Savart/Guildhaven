import React from 'react';

interface FormattedMarkdownProps {
  content: string;
  compact?: boolean;
  className?: string;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches: [label](https://...), **bold**, __bold__, `code`, *italic* (non-space boundaries)
  const tokenRegex =
    /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*(?!\s)[^*]+(?<!\s)\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      const inner = token.slice(2, -2);
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {renderInline(inner, key)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] text-amber-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      const inner = token.slice(1, -1);
      nodes.push(
        <em key={key} className="italic text-slate-100">
          {renderInline(inner, key)}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed);
}

export const FormattedMarkdown: React.FC<FormattedMarkdownProps> = ({
  content,
  compact = false,
  className = '',
}) => {
  const normalized = (content || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;

  const lines = normalized.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-200 leading-relaxed"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(
        <hr key={`hr-${blocks.length}`} className="border-t border-slate-800/90 my-1" />
      );
      i++;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const key = `h-${blocks.length}`;
      if (level === 1) {
        blocks.push(
          <h3
            key={key}
            className="font-display text-base font-bold tracking-tight text-white leading-snug pt-0.5"
          >
            {renderInline(headingText, key)}
          </h3>
        );
      } else if (level === 2) {
        blocks.push(
          <h4
            key={key}
            className="text-sm font-semibold text-amber-300 leading-snug pt-2 border-t border-slate-800/70 first:border-t-0 first:pt-0"
          >
            {renderInline(headingText, key)}
          </h4>
        );
      } else {
        blocks.push(
          <h5 key={key} className="text-xs font-semibold text-slate-100 leading-snug pt-1">
            {renderInline(headingText, key)}
          </h5>
        );
      }
      i++;
      continue;
    }

    // GFM Table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|') && !isTableSeparator(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const key = `tbl-${blocks.length}`;
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="bg-slate-900/90 text-slate-200">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={`${key}-th-${hIdx}`} className="border-b border-slate-800 px-2.5 py-2 font-semibold">
                    {renderInline(h, `${key}-th-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950/50 text-slate-300">
              {rows.map((row, rIdx) => (
                <tr key={`${key}-tr-${rIdx}`}>
                  {headers.map((_, cIdx) => (
                    <td key={`${key}-td-${rIdx}-${cIdx}`} className="px-2.5 py-2 align-top">
                      {renderInline(row[cIdx] ?? '', `${key}-td-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const key = `bq-${blocks.length}`;
      blocks.push(
        <blockquote
          key={key}
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs italic text-slate-300 leading-relaxed"
        >
          {renderInline(quoteLines.join(' '), key)}
        </blockquote>
      );
      continue;
    }

    // Unordered list (including wrapped continuation lines inside an item)
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: Array<{ text: string; nested: boolean }> = [];
      while (i < lines.length) {
        const curRaw = lines[i];
        const curTrim = curRaw.trim();
        if (!curTrim) break;
        const bulletMatch = /^(\s*)([-*+])\s+(.+)$/.exec(curRaw);
        if (bulletMatch) {
          items.push({
            text: bulletMatch[3],
            nested: bulletMatch[1].length >= 2,
          });
          i++;
        } else if (
          !/^(#{1,4}\s+|```|---|\*\*\*|___|\d+\.\s+|>)/.test(curTrim) &&
          items.length > 0
        ) {
          // Continuation line (either indented sub-metadata like `**Text:** ...` or wrapped line)
          items[items.length - 1].text += `\n${curTrim}`;
          i++;
        } else {
          break;
        }
      }
      const key = `ul-${blocks.length}`;
      blocks.push(
        <ul
          key={key}
          className={`space-y-1.5 pl-4 list-disc marker:text-amber-400/80 ${
            compact ? 'text-xs' : 'text-[12.5px]'
          } text-slate-200 leading-relaxed`}
        >
          {items.map((item, idx) => {
            const subLines = item.text.split('\n');
            return (
              <li key={`${key}-li-${idx}`} className={item.nested ? 'ml-4' : undefined}>
                {subLines.map((sub, sIdx) => (
                  <React.Fragment key={`${key}-li-${idx}-${sIdx}`}>
                    {sIdx > 0 && <br />}
                    {renderInline(sub, `${key}-li-${idx}-${sIdx}`)}
                  </React.Fragment>
                ))}
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const curRaw = lines[i];
        const curTrim = curRaw.trim();
        if (!curTrim) break;
        const numMatch = /^\s*\d+\.\s+(.+)$/.exec(curRaw);
        if (numMatch) {
          items.push(numMatch[1]);
          i++;
        } else if (
          !/^(#{1,4}\s+|```|---|\*\*\*|___|[-*+]\s+|>)/.test(curTrim) &&
          items.length > 0
        ) {
          items[items.length - 1] += `\n${curTrim}`;
          i++;
        } else {
          break;
        }
      }
      const key = `ol-${blocks.length}`;
      blocks.push(
        <ol
          key={key}
          className={`space-y-1.5 pl-5 list-decimal marker:text-amber-400 marker:font-semibold ${
            compact ? 'text-xs' : 'text-[12.5px]'
          } text-slate-200 leading-relaxed`}
        >
          {items.map((item, idx) => {
            const subLines = item.split('\n');
            return (
              <li key={`${key}-oli-${idx}`}>
                {subLines.map((sub, sIdx) => (
                  <React.Fragment key={`${key}-oli-${idx}-${sIdx}`}>
                    {sIdx > 0 && <br />}
                    {renderInline(sub, `${key}-oli-${idx}-${sIdx}`)}
                  </React.Fragment>
                ))}
              </li>
            );
          })}
        </ol>
      );
      continue;
    }

    // Regular paragraph (supports consecutive lines like Format / Status metadata)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const curTrim = lines[i].trim();
      if (
        !curTrim ||
        /^(#{1,4}\s+|```|---|\*\*\*|___|[-*+]\s+|\d+\.\s+|>)/.test(curTrim) ||
        (curTrim.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(curTrim);
      i++;
    }
    const key = `p-${blocks.length}`;
    blocks.push(
      <p
        key={key}
        className={`${compact ? 'text-xs' : 'text-[12.5px]'} text-slate-200 leading-relaxed`}
      >
        {paraLines.map((pl, pIdx) => (
          <React.Fragment key={`${key}-${pIdx}`}>
            {pIdx > 0 && <br />}
            {renderInline(pl, `${key}-${pIdx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className={`${compact ? 'space-y-2' : 'space-y-3'} ${className}`}>{blocks}</div>;
};
