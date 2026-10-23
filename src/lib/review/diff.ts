import { diffLines } from "diff";
import type { ChangeFile, LineChange, ReviewedFile } from "./types";

function splitDiffLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  if (value.endsWith("\n")) lines.pop();
  return lines;
}

export function lineDiff(
  previous: string,
  next: string,
): { added: LineChange[]; removed: LineChange[] } {
  const parts = diffLines(previous ?? "", next ?? "");
  const added: LineChange[] = [];
  const removed: LineChange[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of parts) {
    const lines = splitDiffLines(part.value);
    if (part.added) {
      for (const text of lines) added.push({ line: newLine++, text });
    } else if (part.removed) {
      for (const text of lines) removed.push({ line: oldLine++, text });
    } else {
      oldLine += lines.length;
      newLine += lines.length;
    }
  }
  return { added, removed };
}

/** Unified diff hunks, as returned by the GitHub pull-request files API. */
export function parseUnifiedDiff(patch: string): {
  added: LineChange[];
  removed: LineChange[];
} {
  const added: LineChange[] = [];
  const removed: LineChange[] = [];
  let newLine = 1;
  let oldLine = 1;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        inHunk = true;
      }
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) added.push({ line: newLine++, text: line.slice(1) });
    else if (line.startsWith("-")) removed.push({ line: oldLine++, text: line.slice(1) });
    else {
      oldLine += 1;
      newLine += 1;
    }
  }
  return { added, removed };
}

export function reviewFile(file: ChangeFile): ReviewedFile {
  const previousContent = file.previousContent ?? "";
  const content = file.content ?? "";
  if (file.partial && file.patch) {
    return {
      path: file.path,
      status: file.status,
      content,
      previousContent,
      ...parseUnifiedDiff(file.patch),
    };
  }
  if (file.content !== undefined || file.previousContent !== undefined) {
    return {
      path: file.path,
      status: file.status,
      content,
      previousContent,
      ...lineDiff(previousContent, content),
    };
  }
  if (file.patch) {
    return {
      path: file.path,
      status: file.status,
      content,
      previousContent,
      ...parseUnifiedDiff(file.patch),
    };
  }
  return {
    path: file.path,
    status: file.status,
    content,
    previousContent,
    added: [],
    removed: [],
  };
}

export function changedLineCount(file: ChangeFile): number {
  const reviewed = reviewFile(file);
  return reviewed.added.length + reviewed.removed.length;
}

/** Files whose content changed between two full trees. */
export function deltaFiles(previous: ChangeFile[], next: ChangeFile[]): ChangeFile[] {
  const previousByPath = new Map(previous.map((file) => [file.path, file]));
  const nextPaths = new Set(next.map((file) => file.path));
  const out: ChangeFile[] = [];
  for (const file of next) {
    const prior = previousByPath.get(file.path);
    const priorContent = prior?.content ?? "";
    const nextContent = file.content ?? "";
    if (prior && priorContent === nextContent && file.content !== undefined) continue;
    out.push({
      path: file.path,
      status: prior ? "modified" : file.status,
      previousContent: prior ? priorContent : (file.previousContent ?? ""),
      content: file.content,
      patch: prior ? undefined : file.patch,
    });
  }
  for (const file of previous) {
    if (!nextPaths.has(file.path)) {
      out.push({
        path: file.path,
        status: "deleted",
        previousContent: file.content ?? "",
        content: "",
      });
    }
  }
  return out;
}

/** Follow-up snapshots list only the files that moved. Unlisted files stay. */
export function applySparse(previous: ChangeFile[], update: ChangeFile[]): ChangeFile[] {
  const map = new Map(previous.map((file) => [file.path, file]));
  for (const file of update) {
    if (file.status === "deleted") map.delete(file.path);
    else map.set(file.path, { ...file, status: map.has(file.path) ? "modified" : file.status });
  }
  return [...map.values()];
}
