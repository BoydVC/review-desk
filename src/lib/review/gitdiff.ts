import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChangeFile, EvalCase, ReviewSession } from "./types";

export interface DiffIndexEntry {
  number: number;
  title: string;
  state?: string;
  head?: string;
  base?: string;
  url?: string;
  diff_file: string;
  bytes?: number;
  truncated_or_error?: string | null;
}

const MAX_RECONSTRUCTED_LINE = 200_000;

/** Split a unified diff that starts at `diff --git` into one change per file. */
export function parseGitDiff(diffText: string): ChangeFile[] {
  const text = diffText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const start = text.indexOf("diff --git ");
  if (start === -1) return [];
  const body = text.slice(start);
  const parts = body.split(/^diff --git /m).filter((part) => part.trim().length > 0);
  const files: ChangeFile[] = [];
  for (const part of parts) {
    const file = parseFileSection(part);
    if (file) files.push(file);
  }
  return files;
}

function parseFileSection(section: string): ChangeFile | null {
  const newline = section.indexOf("\n");
  const header = newline === -1 ? section : section.slice(0, newline);
  const rest = newline === -1 ? "" : section.slice(newline + 1);
  const { oldPath, newPath } = splitGitPaths(header.trim());
  if (!newPath && !oldPath) return null;
  const preamble = rest.split(/^@@/m)[0] ?? "";
  const binary = /^(Binary files |GIT binary patch)/m.test(rest);
  const added = /new file mode /.test(preamble) || oldPath === "/dev/null";
  const deleted = /deleted file mode /.test(preamble) || newPath === "/dev/null";
  const renamed = /rename from /.test(preamble);
  const status: ChangeFile["status"] = deleted ? "deleted" : added ? "added" : renamed ? "renamed" : "modified";
  const filePath = deleted ? stripPrefix(oldPath) : stripPrefix(newPath);
  if (!filePath || filePath === "/dev/null") return null;
  if (binary) {
    return { path: filePath, status, partial: true };
  }
  const hunkAt = rest.indexOf("\n@@");
  const patch = hunkAt === -1 ? (rest.startsWith("@@") ? rest : undefined) : rest.slice(hunkAt + 1);
  const rebuilt = patch ? reconstruct(patch) : { content: undefined, previousContent: undefined };
  return {
    path: filePath,
    status,
    partial: true,
    patch,
    content: rebuilt.content,
    previousContent: rebuilt.previousContent,
  };
}

function reconstruct(patch: string): { content?: string; previousContent?: string } {
  const next: string[] = [];
  const prev: string[] = [];
  let inHunk = false;
  let newLine = 1;
  let oldLine = 1;
  let tooLong = false;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw);
      if (!match) continue;
      oldLine = Math.max(1, Number(match[1]));
      newLine = Math.max(1, Number(match[2]));
      inHunk = true;
      if (oldLine > MAX_RECONSTRUCTED_LINE || newLine > MAX_RECONSTRUCTED_LINE) tooLong = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\") || tooLong) continue;
    if (raw.startsWith("+")) {
      put(next, newLine, raw.slice(1));
      newLine += 1;
    } else if (raw.startsWith("-")) {
      put(prev, oldLine, raw.slice(1));
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      const text = raw.slice(1);
      put(next, newLine, text);
      put(prev, oldLine, text);
      newLine += 1;
      oldLine += 1;
    }
    if (newLine > MAX_RECONSTRUCTED_LINE || oldLine > MAX_RECONSTRUCTED_LINE) tooLong = true;
  }
  if (tooLong) return {};
  return {
    content: next.length > 0 ? `${next.join("\n")}\n` : undefined,
    previousContent: prev.length > 0 ? `${prev.join("\n")}\n` : undefined,
  };
}

function put(lines: string[], lineNo: number, text: string) {
  if (lineNo < 1 || lineNo > MAX_RECONSTRUCTED_LINE) return;
  while (lines.length < lineNo - 1) lines.push("");
  lines[lineNo - 1] = text;
}

function splitGitPaths(spec: string): { oldPath: string; newPath: string } {
  const tokens: string[] = [];
  let index = 0;
  while (index < spec.length && tokens.length < 2) {
    while (spec[index] === " ") index += 1;
    if (index >= spec.length) break;
    if (spec[index] === '"') {
      let cursor = index + 1;
      let value = "";
      while (cursor < spec.length) {
        if (spec[cursor] === "\\" && cursor + 1 < spec.length) {
          value += spec[cursor + 1];
          cursor += 2;
          continue;
        }
        if (spec[cursor] === '"') break;
        value += spec[cursor];
        cursor += 1;
      }
      tokens.push(value);
      index = cursor + 1;
      continue;
    }
    let cursor = index;
    while (cursor < spec.length && spec[cursor] !== " ") cursor += 1;
    tokens.push(spec.slice(index, cursor));
    index = cursor;
  }
  return { oldPath: tokens[0] ?? "", newPath: tokens[1] ?? tokens[0] ?? "" };
}

function stripPrefix(filePath: string): string {
  if (filePath === "/dev/null") return filePath;
  if (filePath.startsWith("a/") || filePath.startsWith("b/")) return filePath.slice(2);
  return filePath;
}

export function loadDiffFolder(dir: string): { dir: string; indexName: string; cases: EvalCase[] } {
  const resolved = path.resolve(dir);
  const names = readdirSync(resolved);
  const indexName = names.includes("index.json")
    ? "index.json"
    : names.find((name) => name.startsWith("index") && name.endsWith(".json"));
  if (!indexName) throw new Error(`No index.json in ${resolved}.`);
  const parsed = JSON.parse(readFileSync(path.join(resolved, indexName), "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${indexName} must be an array of pull requests.`);
  const cases = parsed.map((entry, index) => {
    const row = asEntry(entry, `${indexName}[${index}]`);
    const file = resolveDiffFile(resolved, names, row);
    const diff = readFileSync(file, "utf8");
    return evalCaseFromDiff(row, diff);
  });
  return { dir: resolved, indexName, cases };
}

export function evalCaseFromDiff(entry: DiffIndexEntry, diffText: string): EvalCase {
  const files = parseGitDiff(diffText);
  const truncated = entry.truncated_or_error ? ` Truncation note: ${entry.truncated_or_error}.` : "";
  return {
    groundTruth: false,
    expected: [],
    pr: {
      id: `draft-day-${entry.number}`,
      provenance: "imported",
      provenanceNote:
        `Imported from a local unified diff for BoydVC/draft-day#${entry.number}. ` +
        "Not a seeded example. Ground truth was not inferred." +
        truncated,
      repo: "BoydVC/draft-day",
      number: entry.number,
      title: entry.title,
      body: entry.url ?? "",
      author: "unknown",
      authorTrusted: false,
      baseSha: entry.base ?? "base",
      headSha: entry.head ?? "head",
      files,
      repoPaths: files.map((file) => file.path),
      treeComplete: false,
    },
  };
}

function resolveDiffFile(dir: string, names: string[], entry: DiffIndexEntry): string {
  const exact = path.join(dir, entry.diff_file);
  if (existsSync(exact)) return exact;
  const stem = path.basename(entry.diff_file, ".diff");
  const hit = names.find(
    (name) =>
      (name.startsWith(`${stem}_`) && name.endsWith(".diff")) ||
      (name.startsWith(`${stem}.`) && name.endsWith(".diff")),
  );
  if (!hit) {
    throw new Error(
      `Missing ${entry.diff_file} for pull #${entry.number}. Looked for ${stem}_*.diff in ${dir}.`,
    );
  }
  return path.join(dir, hit);
}

export function writeDiffCases(cases: EvalCase[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const item of cases) {
    const name = `pr-${String(item.pr.number).padStart(2, "0")}.json`;
    const file = path.join(outDir, name);
    writeFileSync(file, JSON.stringify(item));
    written.push(file);
  }
  return written;
}

export interface DiffPullSummary {
  number: number;
  title: string;
  id: string;
  tier: string;
  depth: string;
  files: number;
  kept: number;
  rejected: number;
  dropped: number;
  findings: Array<{
    bugClass: string;
    path: string;
    line: number;
    title: string;
    yesVotes: number;
    panelSize: number;
  }>;
}

export interface DiffReviewSummary {
  pulls: number;
  files: number;
  kept: number;
  rejected: number;
  dropped: number;
  byClass: Record<string, number>;
  byTier: Record<string, number>;
  items: DiffPullSummary[];
}

export function summarizeDiffSessions(sessions: ReviewSession[]): DiffReviewSummary {
  const byClass: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const items = sessions.map((session) => {
    byTier[session.risk.tier] = (byTier[session.risk.tier] ?? 0) + 1;
    const findings = session.findings.map((finding) => {
      byClass[finding.bugClass] = (byClass[finding.bugClass] ?? 0) + 1;
      return {
        bugClass: finding.bugClass,
        path: finding.path,
        line: finding.line,
        title: finding.title,
        yesVotes: finding.yesVotes,
        panelSize: finding.panelSize,
      };
    });
    const rejected = session.rounds.reduce((sum, round) => sum + round.rejected.length, 0);
    const dropped = session.rounds.reduce((sum, round) => sum + round.dropped.length, 0);
    return {
      number: session.pr.number,
      title: session.pr.title,
      id: session.pr.id,
      tier: session.risk.tier,
      depth: session.risk.depth,
      files: session.pr.files.length,
      kept: findings.length,
      rejected,
      dropped,
      findings,
    };
  });
  return {
    pulls: items.length,
    files: items.reduce((sum, item) => sum + item.files, 0),
    kept: items.reduce((sum, item) => sum + item.kept, 0),
    rejected: items.reduce((sum, item) => sum + item.rejected, 0),
    dropped: items.reduce((sum, item) => sum + item.dropped, 0),
    byClass,
    byTier,
    items,
  };
}

export function formatDiffReview(summary: DiffReviewSummary, baseline: string): string {
  const classes = Object.entries(summary.byClass)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
  const tiers = ["high", "medium", "low"].map((tier) => `${tier} ${summary.byTier[tier] ?? 0}`).join(", ");
  const lines = [
    baseline,
    `draft-day diffs  pulls ${summary.pulls}  files ${summary.files}  kept ${summary.kept}  rejected ${summary.rejected}  dropped ${summary.dropped}`,
    `tiers  ${tiers}`,
    `kept by class  ${classes || "none"}`,
    "Recall and precision are not computed for these pulls. No confirmed bug list was supplied, and groundTruth is false.",
    "",
  ];
  for (const item of summary.items) {
    lines.push(
      `#${item.number}  ${item.tier}/${item.depth}  files ${item.files}  kept ${item.kept}  rejected ${item.rejected}  ${item.title}`,
    );
    for (const finding of item.findings) {
      lines.push(
        `    ${finding.bugClass}  ${finding.yesVotes}/${finding.panelSize}  ${finding.path}:${finding.line}  ${finding.title}`,
      );
    }
  }
  return lines.join("\n");
}

function asEntry(input: unknown, source: string): DiffIndexEntry {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${source} is not an object.`);
  }
  const record = input as Record<string, unknown>;
  const number = record.number;
  const title = record.title;
  const diffFile = record.diff_file;
  if (typeof number !== "number") throw new Error(`${source} is missing number.`);
  if (typeof title !== "string" || title.trim() === "") throw new Error(`${source} is missing title.`);
  if (typeof diffFile !== "string" || diffFile.trim() === "") throw new Error(`${source} is missing diff_file.`);
  return {
    number,
    title,
    state: typeof record.state === "string" ? record.state : undefined,
    head: typeof record.head === "string" ? record.head : undefined,
    base: typeof record.base === "string" ? record.base : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    diff_file: diffFile,
    bytes: typeof record.bytes === "number" ? record.bytes : undefined,
    truncated_or_error: typeof record.truncated_or_error === "string" ? record.truncated_or_error : null,
  };
}
