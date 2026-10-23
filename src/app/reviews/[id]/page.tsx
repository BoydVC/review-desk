import Link from "next/link";
import { Suspense } from "react";
import { DepthBadge, ProvenanceBadge, RoundPips, StatusBadge, TierBadge } from "@/components/marks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAction } from "@/app/reviews/actions";
import { getDesk } from "@/lib/desk";
import { cardById } from "@/lib/review/experts";
import { mergeGate } from "@/lib/review/pipeline";

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; finding?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Opening the review…</p>}>
      <ReviewDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; finding?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const store = await getDesk();
  const session = store.sessions.find((item) => item.id === id);
  if (!session) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl">That review is not on the desk.</h1>
        <p className="text-muted-foreground">The id does not match a seeded example or an imported pull.</p>
        <Link href="/" className="underline">
          Back to the desk
        </Link>
      </div>
    );
  }
  const gate = mergeGate(session);
  const error = query.error;
  const errorFinding = query.finding;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          Back to the desk
        </Link>
        <p className="text-sm text-muted-foreground">
          {session.pr.repo} #{session.pr.number} · {session.pr.author}
          {session.risk.trustedAuthor ? "" : " · not on the trusted list"}
        </p>
        <h1 className="text-4xl leading-tight">{session.pr.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={session.risk.tier} />
          <DepthBadge depth={session.risk.depth} />
          <ProvenanceBadge provenance={session.pr.provenance} />
          <StatusBadge status={session.status} />
          <RoundPips rounds={session.rounds.length} />
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{session.pr.provenanceNote}</p>
        {session.pr.inspiredBy ? (
          <p className="max-w-3xl text-sm leading-6">{session.pr.inspiredBy}</p>
        ) : null}
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Why this tier</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm leading-6">
            {session.risk.reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
            <p>
              Depth is {session.risk.depth} because the tier is {session.risk.tier}. The author does not choose it.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Merge gate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm leading-6">
            {gate.ok ? (
              <p>Automated review is clear and this tier does not ask for a person.</p>
            ) : (
              gate.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)
            )}
            {session.risk.extraHumanReasons.map((reason) => (
              <p key={reason} className="text-muted-foreground">
                {reason}
              </p>
            ))}
            {session.capNote ? <p>{session.capNote}</p> : null}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Rounds</h2>
        <ol className="flex flex-col gap-3">
          {session.rounds.map((round) => (
            <li key={round.round} className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
              <p className="font-medium">
                Round {round.round} · {round.scope === "full" ? "full diff" : "new lines only"} · {round.depth}
              </p>
              <p className="text-muted-foreground">
                {round.filesReviewed.length === 0
                  ? "No files in scope."
                  : round.filesReviewed.join(", ")}
              </p>
              <p>
                {round.candidates} {round.candidates === 1 ? "candidate" : "candidates"} · {round.dropped.length} dropped before the vote ·{" "}
                {round.rejected.length} failed quorum · {round.kept} kept
              </p>
              <p className="text-muted-foreground">
                Hunters: {round.hunterIds.join(", ")}. Voters: {round.voterIds.join(", ")}.
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Findings</h2>
        {session.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">The quorum kept nothing. This diff is clean on the desk.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {session.findings.map((finding) => {
              const card = cardById(finding.expertCardId);
              return (
                <li key={finding.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={finding.status === "open" ? "destructive" : "secondary"}>{finding.status}</Badge>
                        <Badge variant="outline">{finding.bugClass}</Badge>
                        <Badge variant="outline">
                          {finding.yesVotes} of {finding.panelSize} voted real
                        </Badge>
                      </div>
                      <CardTitle className="text-xl">{finding.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 text-sm leading-6">
                      <p>
                        {finding.path}:{finding.line} · {finding.symbol}
                      </p>
                      <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">{finding.evidence}</pre>
                      <p>{finding.body}</p>
                      {card ? (
                        <p>
                          Lens:{" "}
                          <Link href={`/experts#${card.id}`} className="underline">
                            {card.person}
                          </Link>
                        </p>
                      ) : null}
                      <ul className="flex flex-col gap-1 text-muted-foreground">
                        {finding.votes.map((vote) => (
                          <li key={vote.voterId}>
                            {vote.real ? "Yes" : "No"} · {vote.voterId}: {vote.reason}
                          </li>
                        ))}
                      </ul>
                      {finding.resolution ? (
                        <p>
                          {finding.resolution.source === "re-review" ? "Re-review" : "Author"} {finding.resolution.kind}:{" "}
                          {finding.resolution.reason}
                        </p>
                      ) : null}
                      {finding.status === "open" ? (
                        <form action={resolveAction} className="mt-2 flex flex-col gap-3">
                          <input type="hidden" name="reviewId" value={session.id} />
                          <input type="hidden" name="findingId" value={finding.id} />
                          <Label htmlFor={`reason-${finding.id}`}>Written reason</Label>
                          <Textarea
                            id={`reason-${finding.id}`}
                            name="reason"
                            required
                            minLength={12}
                            placeholder="What you changed, or why this is not a bug."
                          />
                          {error && errorFinding === finding.id ? (
                            <p className="text-destructive">{error}</p>
                          ) : null}
                          <fieldset className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <label className="flex items-center gap-2">
                              <input type="radio" name="kind" value="fixed" defaultChecked />
                              Fixed
                            </label>
                            <label className="flex items-center gap-2">
                              <input type="radio" name="kind" value="closed" />
                              Close as not a bug
                            </label>
                          </fieldset>
                          <div>
                            <Button type="submit">Record disposition</Button>
                          </div>
                        </form>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {session.rounds.some((round) => round.rejected.length > 0 || round.dropped.length > 0) ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl">Kept off the desk</h2>
          {session.rounds.map((round) => (
            <details key={round.round} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <summary className="cursor-pointer">
                Round {round.round}: {round.dropped.length} dropped, {round.rejected.length} rejected by quorum
              </summary>
              <ul className="mt-3 flex flex-col gap-2">
                {round.dropped.map((item) => (
                  <li key={`${item.candidate.bugClass}-${item.candidate.line}`}>
                    Dropped · {item.candidate.bugClass} · {item.reason}
                  </li>
                ))}
                {round.rejected.map((item) => (
                  <li key={`${item.candidate.bugClass}-${item.candidate.line}-${item.candidate.symbol}`}>
                    Quorum {item.yesVotes}/{item.quorumRequired} · {item.candidate.title}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
