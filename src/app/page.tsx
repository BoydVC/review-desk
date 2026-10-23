import Link from "next/link";
import { Suspense } from "react";
import { DepthBadge, ProvenanceBadge, RoundPips, StatusBadge, TierBadge } from "@/components/marks";
import { Card, CardContent } from "@/components/ui/card";
import { getDesk } from "@/lib/desk";
import { summarize } from "@/lib/review/store";

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Opening the desk…</p>}>
      <Desk />
    </Suspense>
  );
}

async function Desk() {
  const store = await getDesk();
  const stats = summarize(store.sessions);
  const sessions = [...store.sessions].sort((a, b) => a.pr.number - b.pr.number);
  const mean = Math.round(stats.meanRounds * 10) / 10;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Agent-written pull requests</p>
        <h1 className="max-w-3xl text-4xl leading-tight sm:text-5xl">
          Findings stay off the desk until a quorum says they are real.
        </h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground">
          Several hunters read each diff in parallel. A separate panel votes, and a finding is kept only when
          enough of them agree. The change picks a risk tier, the tier picks the depth, and re-review stops after
          three rounds. Later rounds read only the new lines.
        </p>
      </section>

      <aside className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
        <p className="font-medium">These pulls are seeded examples, not BoydVC/draft-day.</p>
        <p className="text-muted-foreground">{store.access.note}</p>
      </aside>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={String(stats.bugsCaught)} label="Bugs caught" detail="Kept findings later marked fixed." />
        <Stat value={String(stats.falseAlarms)} label="False alarms" detail="Kept findings closed with a written reason." />
        <Stat value={String(stats.open)} label="Still open" detail="Blocking until fixed or closed." />
        <Stat value={String(mean)} label="Rounds per PR" detail={`Across ${stats.pulls} pulls. Cap is 3.`} />
      </section>

      <section className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Risk tiers on the desk</span>
        <TierBadge tier="high" />
        <span>{stats.byTier.high}</span>
        <TierBadge tier="medium" />
        <span>{stats.byTier.medium}</span>
        <TierBadge tier="low" />
        <span>{stats.byTier.low}</span>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl">Pulls</h2>
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => {
            const fixed = session.findings.filter((finding) => finding.status === "fixed").length;
            const closed = session.findings.filter((finding) => finding.status === "closed").length;
            const open = session.findings.filter((finding) => finding.status === "open").length;
            return (
              <li key={session.id}>
                <Link href={`/reviews/${session.id}`} className="block">
                  <Card className="transition-colors hover:bg-accent/40">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {session.pr.repo} #{session.pr.number}
                          </p>
                          <h3 className="text-lg leading-snug">{session.pr.title}</h3>
                        </div>
                        <StatusBadge status={session.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <TierBadge tier={session.risk.tier} />
                        <DepthBadge depth={session.risk.depth} />
                        <ProvenanceBadge provenance={session.pr.provenance} />
                        <RoundPips rounds={session.rounds.length} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {open} open · {fixed} fixed · {closed} closed · {session.risk.humanApprovals}{" "}
                        {session.risk.humanApprovals === 1 ? "human approval" : "human approvals"}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Stat({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="font-heading text-3xl">{value}</p>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
