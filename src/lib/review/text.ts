export function isMarkdown(path: string): boolean {
  return /\.(md|mdx)$/i.test(path);
}

export function isTestPath(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path) || path.includes("__tests__/");
}

export function isCodePath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs|java)$/.test(path);
}

export function isDocsPath(path: string): boolean {
  return isMarkdown(path) || /\.(txt|png|jpg|jpeg|gif|svg|webp)$/i.test(path);
}

/** Comments in source, not markdown headings. */
export function lineIsCodeComment(text: string, path: string): boolean {
  if (isMarkdown(path)) return false;
  const trimmed = text.trim();
  if (/\.(yml|yaml|py|rb|sh)$/.test(path)) return trimmed.startsWith("#");
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("<!--")
  );
}

export function stripCodeComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trim();
}

export function testPathsFor(sourcePath: string): string[] {
  const parts = sourcePath.split("/");
  const file = parts.pop() ?? sourcePath;
  const dir = parts.join("/");
  const stem = file.replace(/\.[jt]sx?$/, "");
  const base = dir ? `${dir}/${stem}` : stem;
  const prefix = dir ? `${dir}/` : "";
  return [
    `${base}.test.ts`,
    `${base}.test.tsx`,
    `${base}.test.js`,
    `${base}.spec.ts`,
    `${base}.spec.tsx`,
    `${prefix}__tests__/${stem}.test.ts`,
    `${prefix}__tests__/${stem}.ts`,
  ];
}

export function enclosingFunction(source: string, line: number): string {
  const lines = source.split("\n").slice(0, line);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /(?:function|class)\s+([A-Za-z_][\w]*)/.exec(lines[i] ?? "");
    if (match) return match[1];
  }
  return "anonymous";
}

export interface CatchBlock {
  line: number;
  header: string;
  body: string;
}

export function catchBlocks(source: string): CatchBlock[] {
  const blocks: CatchBlock[] = [];
  const re = /\bcatch\b[^{;]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const open = match.index + match[0].length;
    let depth = 1;
    let cursor = open;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      cursor += 1;
    }
    const body = source.slice(open, Math.max(open, cursor - 1));
    const line = source.slice(0, match.index).split("\n").length;
    const header = source.split("\n")[line - 1] ?? "";
    blocks.push({ line, header, body });
    re.lastIndex = cursor;
  }
  return blocks;
}

export function isSwallowedCatch(body: string): boolean {
  const stripped = stripCodeComments(body);
  if (!stripped) return true;
  const withoutConsole = stripped
    .replace(/console\.(log|error|warn|debug|info)\([^;]*\);?/g, "")
    .trim();
  return withoutConsole.length === 0;
}
