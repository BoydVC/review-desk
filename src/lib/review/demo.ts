import { exampleFixtures } from "./examples";
import { openSession, resolveFinding, reviewRound } from "./pipeline";
import type { ReviewSession } from "./types";

const resolutions: Array<{
  prId: string;
  bugClass: string;
  symbol: string;
  kind: "fixed" | "closed";
  reason: string;
}> = [
  {
    prId: "example-sql-injection",
    bugClass: "sql-injection",
    symbol: "query",
    kind: "fixed",
    reason: "Bound the title term as a parameter instead of interpolating it into the SQL.",
  },
  {
    prId: "example-hardcoded-secret",
    bugClass: "hardcoded-secret",
    symbol: "apiKey",
    kind: "fixed",
    reason: "Removed the live key. The client now reads PAYMENTS_API_KEY from the environment.",
  },
  {
    prId: "example-falsy-limit",
    bugClass: "falsy-default",
    symbol: "limit",
    kind: "closed",
    reason: "Upstream validation rejects 0, so this default only replaces undefined. Leaving the || in place.",
  },
  {
    prId: "example-off-by-one",
    bugClass: "off-by-one",
    symbol: "items",
    kind: "fixed",
    reason: "The loop now stops at items.length - 1, so the last index is inside the array.",
  },
  {
    prId: "example-unbounded-retry",
    bugClass: "unbounded-retry",
    symbol: "while",
    kind: "fixed",
    reason: "Capped the poll at five attempts and throw when the draft is still not ready.",
  },
  {
    prId: "example-missing-timeout",
    bugClass: "missing-timeout",
    symbol: "fetch",
    kind: "fixed",
    reason: "Passed an AbortSignal that fires after two seconds so a hung ledger cannot pin the caller.",
  },
  {
    prId: "example-open-transaction",
    bugClass: "transaction-without-commit",
    symbol: "begin",
    kind: "fixed",
    reason: "Commit on success and roll back in the catch, then release the connection.",
  },
  {
    prId: "example-unsafe-html",
    bugClass: "unsafe-html",
    symbol: "dangerouslySetInnerHTML",
    kind: "fixed",
    reason: "Sanitized the markup with DOMPurify before writing it into the preview.",
  },
  {
    prId: "example-untested-behavior",
    bugClass: "untested-behavior",
    symbol: "publishStatus",
    kind: "fixed",
    reason: "Added publish.test.ts, which fails if publishStatus stops returning scheduled.",
  },
];

export async function buildDemoSessions(): Promise<ReviewSession[]> {
  const sessions: ReviewSession[] = [];
  for (const item of exampleFixtures) {
    let session = await openSession(item.pr);
    for (const followUp of item.pr.followUps ?? []) {
      session = await reviewRound(session, followUp);
    }
    if (item.pr.id === "example-round-cap") {
      const last = item.pr.followUps?.[item.pr.followUps.length - 1];
      if (last) session = await reviewRound(session, last);
    }
    for (const resolution of resolutions.filter((entry) => entry.prId === item.pr.id)) {
      const finding = session.findings.find(
        (candidate) =>
          candidate.bugClass === resolution.bugClass &&
          candidate.symbol === resolution.symbol &&
          candidate.status === "open",
      );
      if (!finding) {
        throw new Error(`Demo resolution missed ${resolution.prId} ${resolution.bugClass} ${resolution.symbol}.`);
      }
      session = resolveFinding(session, finding.id, {
        kind: resolution.kind,
        reason: resolution.reason,
      });
    }
    sessions.push(session);
  }
  return sessions;
}
