import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for untrusted file previews (PLAN §37.4). It builds React elements only (text is
 * escaped by React), never uses `dangerouslySetInnerHTML`, never renders images or raw HTML, and only turns http(s) and
 * mailto targets into links.
 */

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(!?\[[^\]]*\]\([^)\s]*\))/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const image = token.startsWith("!");
      const link = /^!?\[([^\]]*)\]\(([^)\s]*)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const target = link?.[2] ?? "";
      if (!image && SAFE_LINK.test(target)) {
        nodes.push(
          <a key={key} href={target} target="_blank" rel="noopener noreferrer nofollow">
            {label}
          </a>,
        );
      } else {
        // Images and unsafe schemes (javascript:, data:, relative paths) degrade to their visible text.
        nodes.push(label);
      }
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isTableSeparator = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function SafeMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const next = (): string => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = /^```/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={next()} className="fl-md__code">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, (heading[1] ?? "#").length);
      const k = next();
      const content = renderInline(heading[2] ?? "", k);
      const Tag = (`h${Math.min(6, level + 2)}` as "h3" | "h4" | "h5" | "h6");
      blocks.push(<Tag key={k}>{content}</Tag>);
      i += 1;
      continue;
    }
    if (line.includes("|") && isTableSeparator(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(splitRow(lines[i] ?? ""));
        i += 1;
      }
      const k = next();
      blocks.push(
        <div key={k} className="fl-md__table">
          <table>
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th key={c}>{renderInline(cell, `${k}-h${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell, `${k}-${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*([-*+]|\d+\.)\s+/.exec(line);
    if (bullet) {
      const ordered = /\d+\./.test(bullet[1] ?? "");
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i += 1;
      }
      const k = next();
      const children = items.map((item, n) => <li key={n}>{renderInline(item, `${k}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      const k = next();
      blocks.push(<blockquote key={k}>{renderInline(quote.join(" "), k)}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s+)/.test(lines[i] ?? "")) {
      paragraph.push(lines[i] ?? "");
      i += 1;
    }
    const k = next();
    blocks.push(<p key={k}>{renderInline(paragraph.join(" "), k)}</p>);
  }
  return <div className="fl-md">{blocks}</div>;
}
