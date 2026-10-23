import type { EvalCase, ExpectedBug, Finding, ReviewSession } from "./types";
import { openSession } from "./pipeline";
import type { PipelineOptions } from "./pipeline";

export interface CaseScore {
  id: string;
  title: string;
  provenance: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  recall: number;
  precision: number;
  missed: ExpectedBug[];
  unexpected: Array<{ bugClass: string; path: string; symbol: string; title: string }>;
  forbiddenHits: string[];
}

export interface ScoreReport {
  ranAt: string;
  label: string;
  cases: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  recall: number;
  precision: number;
  falseAlarmRate: number;
  results: CaseScore[];
}

export function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

export function scoreFindings(expected: ExpectedBug[], findings: Finding[], shouldNotFlag: Array<{ bugClass: string; path: string }> = []): Omit<CaseScore, "id" | "title" | "provenance"> {
  const kept = findings.filter((finding) => finding.votes.length === 0 || finding.yesVotes >= finding.quorumRequired);
  const used = new Set<Finding>();
  const missed: ExpectedBug[] = [];
  let truePositives = 0;
  for (const bug of expected) {
    const hit = kept.find(
      (finding) =>
        !used.has(finding) &&
        finding.bugClass === bug.bugClass &&
        finding.path === bug.path &&
        finding.symbol === bug.symbol,
    );
    if (!hit) missed.push(bug);
    else {
      used.add(hit);
      truePositives += 1;
    }
  }
  const unexpected = kept
    .filter((finding) => !used.has(finding))
    .map((finding) => ({
      bugClass: finding.bugClass,
      path: finding.path,
      symbol: finding.symbol,
      title: finding.title,
    }));
  const forbiddenHits = unexpected
    .filter((finding) =>
      shouldNotFlag.some((item) => item.bugClass === finding.bugClass && item.path === finding.path),
    )
    .map((finding) => `${finding.bugClass} @ ${finding.path}`);
  const falsePositives = unexpected.length;
  const falseNegatives = missed.length;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    recall: ratio(truePositives, truePositives + falseNegatives),
    precision: ratio(truePositives, truePositives + falsePositives),
    missed,
    unexpected,
    forbiddenHits,
  };
}

export async function scoreCases(
  cases: EvalCase[],
  options?: PipelineOptions & { label?: string },
): Promise<ScoreReport> {
  const ground = cases.filter((item) => item.groundTruth);
  const results: CaseScore[] = [];
  for (const item of ground) {
    const session: ReviewSession = await openSession(item.pr, options);
    const scored = scoreFindings(item.expected, session.findings, item.shouldNotFlag);
    results.push({
      id: item.pr.id,
      title: item.pr.title,
      provenance: item.pr.provenance,
      ...scored,
    });
  }
  const truePositives = results.reduce((sum, item) => sum + item.truePositives, 0);
  const falsePositives = results.reduce((sum, item) => sum + item.falsePositives, 0);
  const falseNegatives = results.reduce((sum, item) => sum + item.falseNegatives, 0);
  return {
    ranAt: new Date().toISOString(),
    label: options?.label ?? "review-desk score",
    cases: results.length,
    truePositives,
    falsePositives,
    falseNegatives,
    recall: ratio(truePositives, truePositives + falseNegatives),
    precision: ratio(truePositives, truePositives + falsePositives),
    falseAlarmRate: ratio(falsePositives, truePositives + falsePositives),
    results,
  };
}

export function formatReport(report: ScoreReport): string {
  const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
  const lines = [
    `${report.label}  ${report.ranAt}`,
    `cases ${report.cases}  recall ${pct(report.recall)}  precision ${pct(report.precision)}  false alarms ${pct(report.falseAlarmRate)}`,
    `caught ${report.truePositives}  missed ${report.falseNegatives}  unexpected ${report.falsePositives}`,
    "",
  ];
  for (const result of report.results) {
    const flag = result.falseNegatives === 0 && result.falsePositives === 0 ? "ok" : "MISS";
    lines.push(
      `${flag.padEnd(4)} ${result.id}  recall ${pct(result.recall)}  precision ${pct(result.precision)}`,
    );
    for (const bug of result.missed) {
      lines.push(`      missed ${bug.bugClass} ${bug.path} ${bug.symbol}`);
    }
    for (const bug of result.unexpected) {
      lines.push(`      unexpected ${bug.bugClass} ${bug.path} ${bug.symbol}  ${bug.title}`);
    }
  }
  return lines.join("\n");
}
