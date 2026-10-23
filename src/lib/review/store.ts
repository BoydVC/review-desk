import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDemoSessions } from "./demo";
import { exampleFixtures } from "./examples";
import { loadFixtureDir } from "./import";
import { scoreCases, type ScoreReport } from "./score";
import type { EvalCase, ReviewSession } from "./types";

export interface DeskAccess {
  draftDay: "unavailable";
  note: string;
}

export interface DeskStore {
  version: 1;
  generatedAt: string;
  access: DeskAccess;
  sessions: ReviewSession[];
  scores: ScoreReport[];
}

const ACCESS: DeskAccess = {
  draftDay: "unavailable",
  note: "BoydVC/draft-day was not readable from this environment. GitHub returned 404 for pull request 12 without credentials. The desk is showing seeded examples, each labeled as an example. Set GITHUB_TOKEN and run npm run import:draft-day to import PRs 1–15. The importer will not invent contents, and imported pulls are not ground truth until a person confirms the bugs.",
};

export function storePath(): string {
  return path.join(process.cwd(), "data", "desk.json");
}

export function evalDirs(): string[] {
  return [path.join(process.cwd(), "fixtures", "eval"), path.join(process.cwd(), "fixtures", "imported")];
}

export function loadEvalCases(): EvalCase[] {
  const extra = evalDirs().flatMap((dir) => loadFixtureDir(dir)).filter((item) => item.groundTruth);
  return [...exampleFixtures, ...extra];
}

export async function buildDesk(): Promise<DeskStore> {
  const [sessions, score] = await Promise.all([
    buildDemoSessions(),
    scoreCases(loadEvalCases(), { label: "seeded examples" }),
  ]);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    access: ACCESS,
    sessions,
    scores: [score],
  };
}

export function readStore(file = storePath()): DeskStore | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DeskStore;
  } catch {
    return null;
  }
}

export function writeStore(store: DeskStore, file = storePath()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2));
}

export async function ensureStore(file = storePath()): Promise<DeskStore> {
  const existing = readStore(file);
  if (existing) return existing;
  const created = await buildDesk();
  writeStore(created, file);
  return created;
}

export function saveSession(session: ReviewSession, file = storePath()): DeskStore {
  const current = readStore(file);
  if (!current) throw new Error("The desk store does not exist yet.");
  const sessions = current.sessions.some((item) => item.id === session.id)
    ? current.sessions.map((item) => (item.id === session.id ? session : item))
    : [...current.sessions, session];
  const next = { ...current, sessions, generatedAt: new Date().toISOString() };
  writeStore(next, file);
  return next;
}

export function appendScore(report: ScoreReport, file = storePath()): DeskStore {
  const current = readStore(file) ?? {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    access: ACCESS,
    sessions: [],
    scores: [],
  };
  const next = {
    ...current,
    generatedAt: new Date().toISOString(),
    scores: [report, ...current.scores].slice(0, 30),
  };
  writeStore(next, file);
  return next;
}

export function summarize(sessions: ReviewSession[]) {
  const findings = sessions.flatMap((session) => session.findings);
  const bugsCaught = findings.filter((finding) => finding.status === "fixed").length;
  const falseAlarms = findings.filter((finding) => finding.status === "closed").length;
  const open = findings.filter((finding) => finding.status === "open").length;
  const rounds = sessions.reduce((sum, session) => sum + session.rounds.length, 0);
  const byTier = { low: 0, medium: 0, high: 0 };
  for (const session of sessions) byTier[session.risk.tier] += 1;
  return {
    bugsCaught,
    falseAlarms,
    open,
    meanRounds: sessions.length === 0 ? 0 : rounds / sessions.length,
    byTier,
    pulls: sessions.length,
  };
}
