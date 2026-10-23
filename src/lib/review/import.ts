import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ChangeFile, EvalCase, Provenance, PullRequest } from "./types";

export class GithubAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAccessError";
  }
}

const NOTES: Record<Provenance, (note: string) => string | null> = {
  "seeded-example": (note) => {
    const text = note.toLowerCase();
    if (!text.includes("seeded example")) return "Seeded examples must say \"seeded example\" in the provenance note.";
    if (!text.includes("not a pull request")) return "Seeded examples must say they are not a pull request from the private repo.";
    return null;
  },
  github: (note) =>
    note.toLowerCase().includes("imported from github")
      ? null
      : "GitHub imports must say \"Imported from GitHub\" in the provenance note.",
  imported: (note) =>
    note.trim().length >= 12 ? null : "Imported fixtures need a provenance note of at least 12 characters.",
};

export function parseFixture(input: unknown, source = "fixture"): EvalCase {
  if (!input || typeof input !== "object") throw new Error(`${source} is not an object.`);
  const record = input as Record<string, unknown>;
  const prInput = record.pr ?? record;
  const pr = parsePullRequest(prInput, source);
  const expected = Array.isArray(record.expected) ? record.expected.map((item, index) => parseExpected(item, `${source} expected[${index}]`)) : [];
  const groundTruth = record.groundTruth === true;
  if (pr.provenance === "seeded-example" && !groundTruth) {
    throw new Error(`${source} is a seeded example and must set groundTruth: true.`);
  }
  const shouldNotFlag = Array.isArray(record.shouldNotFlag)
    ? record.shouldNotFlag.map((item) => {
        const row = asRecord(item, source);
        return { bugClass: requiredString(row, "bugClass", source), path: requiredString(row, "path", source) };
      })
    : undefined;
  return { pr, groundTruth, expected, shouldNotFlag };
}

export function parsePullRequest(input: unknown, source = "pull request"): PullRequest {
  const record = asRecord(input, source);
  const provenance = requiredString(record, "provenance", source) as Provenance;
  if (!["seeded-example", "github", "imported"].includes(provenance)) {
    throw new Error(`${source} has an unknown provenance "${provenance}".`);
  }
  const provenanceNote = requiredString(record, "provenanceNote", source);
  const noteError = NOTES[provenance](provenanceNote);
  if (noteError) throw new Error(`${source}: ${noteError}`);
  const files = requiredArray(record, "files", source).map((file, index) =>
    parseFile(file, `${source} files[${index}]`),
  );
  return {
    id: requiredString(record, "id", source),
    provenance,
    provenanceNote,
    inspiredBy: optionalString(record, "inspiredBy"),
    repo: requiredString(record, "repo", source),
    number: requiredNumber(record, "number", source),
    title: requiredString(record, "title", source),
    body: optionalString(record, "body") ?? "",
    author: requiredString(record, "author", source),
    authorTrusted: record.authorTrusted === true,
    baseSha: requiredString(record, "baseSha", source),
    headSha: requiredString(record, "headSha", source),
    files,
    repoPaths: Array.isArray(record.repoPaths) ? record.repoPaths.map(String) : files.map((file) => file.path),
    treeComplete: record.treeComplete === false ? false : undefined,
    contextFiles: Array.isArray(record.contextFiles)
      ? record.contextFiles.map((file) => {
          const row = asRecord(file, source);
          return { path: requiredString(row, "path", source), content: requiredString(row, "content", source) };
        })
      : undefined,
  };
}

export function loadFixtureFile(file: string): EvalCase {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return parseFixture(raw, file);
}

export function loadFixtureDir(dir: string): EvalCase[] {
  if (!exists(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => loadFixtureFile(path.join(dir, name)));
}

export interface GithubClient {
  get(pathname: string): Promise<unknown>;
}

export function githubClient(token: string | undefined, fetchImpl: typeof fetch = fetch): GithubClient {
  return {
    async get(pathname: string) {
      const response = await fetchImpl(`https://api.github.com${pathname}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "review-desk",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (response.status === 404 || response.status === 401 || response.status === 403) {
        throw new GithubAccessError(
          `Could not read ${pathname} (${response.status}${body.message ? `: ${body.message}` : ""}). ` +
            "If the repository is private, set GITHUB_TOKEN. Review Desk does not invent pull request contents.",
        );
      }
      if (!response.ok) {
        throw new Error(`GitHub ${pathname} failed (${response.status}${body.message ? `: ${body.message}` : ""}).`);
      }
      return body;
    },
  };
}

export async function importGithubPulls(
  client: GithubClient,
  options: { owner: string; repo: string; from: number; to: number },
): Promise<EvalCase[]> {
  const cases: EvalCase[] = [];
  for (let number = options.from; number <= options.to; number += 1) {
    const base = `/repos/${options.owner}/${options.repo}`;
    let pull: Record<string, unknown>;
    try {
      pull = asRecord(await client.get(`${base}/pulls/${number}`), `PR #${number}`);
    } catch (error) {
      if (error instanceof GithubAccessError && number !== options.from) break;
      throw error;
    }
    const head = asRecord(pull.head, "head");
    const baseRef = asRecord(pull.base, "base");
    const headSha = requiredString(head, "sha", "head");
    const baseSha = requiredString(baseRef, "sha", "base");
    const user = asRecord(pull.user ?? {}, "user");
    const filesPayload = (await client.get(`${base}/pulls/${number}/files?per_page=100`)) as unknown[];
    const treePayload = asRecord(
      await client.get(`${base}/git/trees/${headSha}?recursive=1`).catch(() => ({ tree: [] })),
      "tree",
    );
    const repoPaths = Array.isArray(treePayload.tree)
      ? treePayload.tree
          .map((item) => asRecord(item, "tree item"))
          .filter((item) => item.type === "blob")
          .map((item) => String(item.path))
      : [];
    const files: ChangeFile[] = [];
    for (const raw of Array.isArray(filesPayload) ? filesPayload.slice(0, 40) : []) {
      const row = asRecord(raw, "file");
      const filePath = requiredString(row, "filename", "file");
      const status = mapStatus(String(row.status ?? "modified"));
      const [content, previousContent] = await Promise.all([
        status === "deleted" ? Promise.resolve("") : readGithubFile(client, options, filePath, headSha),
        status === "added" ? Promise.resolve("") : readGithubFile(client, options, filePath, baseSha),
      ]);
      files.push({
        path: filePath,
        status,
        content: content ?? undefined,
        previousContent: previousContent ?? undefined,
        patch: typeof row.patch === "string" ? row.patch : undefined,
      });
    }
    const pr: PullRequest = {
      id: `github-${options.owner}-${options.repo}-${number}`,
      provenance: "github",
      provenanceNote: `Imported from GitHub ${options.owner}/${options.repo}#${number}. Ground truth was not inferred. This is not a seeded example.`,
      repo: `${options.owner}/${options.repo}`,
      number,
      title: requiredString(pull, "title", `PR #${number}`),
      body: typeof pull.body === "string" ? pull.body : "",
      author: typeof user.login === "string" ? user.login : "unknown",
      authorTrusted: false,
      baseSha,
      headSha,
      files,
      repoPaths,
    };
    cases.push({ pr, groundTruth: false, expected: [] });
  }
  return cases;
}

async function readGithubFile(
  client: GithubClient,
  repo: { owner: string; repo: string },
  filePath: string,
  ref: string,
): Promise<string | null> {
  try {
    const payload = asRecord(
      await client.get(
        `/repos/${repo.owner}/${repo.repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
      ),
      filePath,
    );
    if (payload.encoding !== "base64" || typeof payload.content !== "string") return null;
    const size = typeof payload.size === "number" ? payload.size : 0;
    if (size > 100_000) return null;
    return Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch (error) {
    if (error instanceof GithubAccessError) throw error;
    return null;
  }
}

function mapStatus(status: string): ChangeFile["status"] {
  if (status === "added") return "added";
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

function parseFile(input: unknown, source: string): ChangeFile {
  const record = asRecord(input, source);
  const status = requiredString(record, "status", source);
  if (!["added", "modified", "deleted", "renamed"].includes(status)) {
    throw new Error(`${source} has an unknown status.`);
  }
  return {
    path: requiredString(record, "path", source),
    status: status as ChangeFile["status"],
    previousContent: optionalString(record, "previousContent"),
    content: optionalString(record, "content"),
    patch: optionalString(record, "patch"),
    partial: record.partial === true ? true : undefined,
  };
}

function parseExpected(input: unknown, source: string) {
  const record = asRecord(input, source);
  return {
    bugClass: requiredString(record, "bugClass", source),
    path: requiredString(record, "path", source),
    symbol: requiredString(record, "symbol", source),
  };
}

function asRecord(input: unknown, source: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${source} is not an object.`);
  }
  return input as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${source} is missing ${key}.`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function requiredNumber(record: Record<string, unknown>, key: string, source: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`${source} is missing ${key}.`);
  return value;
}

function requiredArray(record: Record<string, unknown>, key: string, source: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${source} is missing ${key}.`);
  return value;
}

function exists(dir: string): boolean {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
