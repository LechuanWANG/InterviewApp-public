import type { ReactNode } from "react";

/**
 * 轻量 Markdown 渲染器（无第三方依赖）。
 * 支持常见子集：#/##/### 标题、- / * / 1. 列表、**加粗**、*斜体*、`代码`、GFM 表格、段落与换行。
 * 用 React 元素渲染（不使用 dangerouslySetInnerHTML），对 LLM 生成内容安全。
 */
export default function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseBlocks(content || "");
  return <div className={className ?? "space-y-2 text-sm leading-6 text-slate-600"}>{blocks}</div>;
}

type ListBuf = { type: "ul" | "ol"; items: string[] };

function parseBlocks(raw: string): ReactNode[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: ListBuf | null = null;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    out.push(
      <p key={`p-${key++}`} className="whitespace-pre-line">
        {joinInline(para)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={`li-${key}-${i}`}>{parseInline(it)}</li>);
    out.push(
      list.type === "ul" ? (
        <ul key={`ul-${key++}`} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      ) : (
        <ol key={`ol-${key++}`} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      )
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }

    // GFM 表格：表头行 + 分隔行（|---|---|），后续相邻的含 | 行为数据行。
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      flushList();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().includes("|") && lines[j].trim()) {
        rows.push(splitTableRow(lines[j].trim()));
        j += 1;
      }
      out.push(renderTable(header, rows, key++));
      i = j - 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const cls =
        level === 1
          ? "text-base font-semibold text-slate-900"
          : level === 2
            ? "text-sm font-semibold text-slate-900"
            : "text-sm font-semibold text-slate-700";
      out.push(
        <div key={`h-${key++}`} className={cls}>
          {parseInline(heading[2])}
        </div>
      );
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(trimmed);
    if (ul) {
      flushPara();
      if (list && list.type !== "ul") flushList();
      if (!list) list = { type: "ul", items: [] };
      list.items.push(ul[1]);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ol) {
      flushPara();
      if (list && list.type !== "ol") flushList();
      if (!list) list = { type: "ol", items: [] };
      list.items.push(ol[1]);
      continue;
    }

    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();
  return out;
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|") || !t.includes("-")) return false;
  const cells = splitTableRow(t);
  return cells.length >= 1 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
}

function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function renderTable(header: string[], rows: string[][], key: number): ReactNode {
  return (
    <div key={`tbl-${key}`} className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {header.map((cell, ci) => (
              <th
                key={ci}
                className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-700"
              >
                {parseInline(cell, key * 100 + ci)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {header.map((_, ci) => (
                <td key={ci} className="border border-slate-200 px-2 py-1 align-top">
                  {parseInline(row[ci] ?? "", key * 1000 + ri * 10 + ci)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function joinInline(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`br-${i}`} />);
    out.push(...parseInline(line, i));
  });
  return out;
}

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

function parseInline(text: string, seed = 0): ReactNode[] {
  const parts = text.split(INLINE_RE).filter((p) => p !== "");
  return parts.map((part, i) => {
    const k = `i-${seed}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={k} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={k}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={k} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-800">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={k}>{part}</span>;
  });
}
