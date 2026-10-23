import type { ChangeFile, EvalCase, Snapshot } from "./types";

const NOTE =
  "Seeded example. Not a pull request from BoydVC/draft-day. The private repository returned 404 to an unauthenticated GitHub request, so this diff was written for Review Desk and is labeled as an example.";

function changed(path: string, content: string, previousContent = ""): ChangeFile {
  return {
    path,
    status: previousContent ? "modified" : "added",
    previousContent,
    content,
  };
}

function example(input: {
  id: string;
  number: number;
  title: string;
  body?: string;
  author?: string;
  authorTrusted?: boolean;
  files: ChangeFile[];
  extraPaths?: string[];
  contextFiles?: EvalCase["pr"]["contextFiles"];
  followUps?: Snapshot[];
  expected: EvalCase["expected"];
  shouldNotFlag?: EvalCase["shouldNotFlag"];
  inspiredBy?: string;
}): EvalCase {
  const repoPaths = [
    ...new Set([...input.files.map((file) => file.path), ...(input.extraPaths ?? [])]),
  ];
  return {
    groundTruth: true,
    expected: input.expected,
    shouldNotFlag: input.shouldNotFlag,
    pr: {
      id: input.id,
      provenance: "seeded-example",
      provenanceNote: NOTE,
      inspiredBy: input.inspiredBy,
      repo: "example/review-desk-fixtures",
      number: input.number,
      title: input.title,
      body: input.body ?? "",
      author: input.author ?? "agent",
      authorTrusted: input.authorTrusted ?? true,
      baseSha: `base-${input.id}`,
      headSha: `head-${input.id}`,
      files: input.files,
      repoPaths,
      contextFiles: input.contextFiles,
      followUps: input.followUps,
    },
  };
}

const chargeRound1 = `export function chargeCard(amount: number) {
  try {
    return gateway.charge(amount);
  } catch (err) {
  }
}
`;

const chargeRound2 = `export function chargeCard(amount: number, options: { limit?: number }) {
  const limit = options.limit || 10;
  try {
    return gateway.charge(Math.min(amount, limit));
  } catch (error) {
    logger.error(error);
    throw error;
  }
}
`;

const chargeRound3 = `export function chargeCard(items: string[], options: { limit?: number }) {
  const limit = options.limit ?? 10;
  for (let i = 0; i <= items.length; i++) {
    gateway.charge(items[i]);
  }
  return limit;
}
`;

export const exampleFixtures: EvalCase[] = [
  example({
    id: "example-readme-links",
    number: 12,
    title: "Point the README at the quickstart examples",
    body: "Document the example files the agent said it added.",
    inspiredBy:
      "Inspired by the bug class described for BoydVC/draft-day PR #12, where a README pointed at example files that did not exist yet. This diff is synthetic. It is not that pull request.",
    extraPaths: ["src/index.ts"],
    files: [
      changed(
        "README.md",
        `# Draft desk

The examples are ready:

- [quickstart](./examples/quickstart.ts)
- [config](examples/config.yml)

Also see the [site](https://example.com) and the [source](src/index.ts).
`,
        "# Draft desk\n\nSee the source.\n",
      ),
    ],
    expected: [
      { bugClass: "docs-missing-target", path: "README.md", symbol: "examples/quickstart.ts" },
      { bugClass: "docs-missing-target", path: "README.md", symbol: "examples/config.yml" },
    ],
  }),
  example({
    id: "example-unknown-script",
    number: 101,
    title: "Document the publish command",
    files: [
      changed(
        "README.md",
        "# Draft desk\n\n```bash\nnpm run publish-draft\n```\n",
        "# Draft desk\n",
      ),
    ],
    contextFiles: [{ path: "package.json", content: '{"scripts":{"dev":"next dev"}}\n' }],
    expected: [{ bugClass: "docs-unknown-script", path: "README.md", symbol: "publish-draft" }],
  }),
  example({
    id: "example-sql-injection",
    number: 102,
    title: "Search drafts by title",
    extraPaths: ["src/search/query.test.ts"],
    files: [
      changed(
        "src/search/query.ts",
        "export function searchDrafts(db: Db, term: string) {\n  return db.query(`SELECT id FROM drafts WHERE title LIKE '%${term}%'`);\n}\n",
      ),
    ],
    expected: [{ bugClass: "sql-injection", path: "src/search/query.ts", symbol: "query" }],
  }),
  example({
    id: "example-hardcoded-secret",
    number: 103,
    title: "Add the payments client",
    extraPaths: ["src/payments/client.test.ts"],
    files: [
      changed(
        "src/payments/client.ts",
        'export function client() {\n  const apiKey = "sk-live-4f8a9c0d1e2b3a4f5c6d7e8f";\n  return connect(apiKey);\n}\n',
      ),
    ],
    expected: [{ bugClass: "hardcoded-secret", path: "src/payments/client.ts", symbol: "apiKey" }],
  }),
  example({
    id: "example-falsy-limit",
    number: 104,
    title: "Default the page size",
    extraPaths: ["src/drafts/pageSize.test.ts"],
    files: [
      changed(
        "src/drafts/pageSize.ts",
        "export function pageSize(options: { limit?: number }) {\n  const limit = options.limit || 25;\n  return limit;\n}\n",
      ),
    ],
    expected: [{ bugClass: "falsy-default", path: "src/drafts/pageSize.ts", symbol: "limit" }],
  }),
  example({
    id: "example-missing-auth",
    number: 105,
    title: "Accept posted drafts",
    extraPaths: ["src/app/api/drafts/route.test.ts"],
    files: [
      changed(
        "src/app/api/drafts/route.ts",
        "export async function POST(request: Request) {\n  const body = await request.json();\n  await saveDraft(body);\n  return Response.json({ ok: true });\n}\n",
      ),
    ],
    expected: [{ bugClass: "missing-auth", path: "src/app/api/drafts/route.ts", symbol: "POST" }],
  }),
  example({
    id: "example-off-by-one",
    number: 106,
    title: "Find the first empty slot",
    extraPaths: ["src/drafts/firstEmpty.test.ts"],
    files: [
      changed(
        "src/drafts/firstEmpty.ts",
        'export function firstEmpty(items: string[]) {\n  // TODO: tighten this later\n  for (let i = 0; i <= items.length; i++) {\n    if (items[i] === "") return i;\n  }\n  return -1;\n}\n',
      ),
    ],
    expected: [{ bugClass: "off-by-one", path: "src/drafts/firstEmpty.ts", symbol: "items" }],
  }),
  example({
    id: "example-removed-export",
    number: 107,
    title: "Trim draft titles",
    extraPaths: ["src/drafts/parse.test.ts"],
    files: [
      changed(
        "src/drafts/parse.ts",
        "export function draftTitle(draft: { title: string }) {\n  return draft.title.trim();\n}\n",
        "export function parseDraft(raw: string) {\n  return JSON.parse(raw);\n}\n\nexport function draftTitle(draft: { title: string }) {\n  return draft.title;\n}\n",
      ),
    ],
    expected: [{ bugClass: "removed-export", path: "src/drafts/parse.ts", symbol: "parseDraft" }],
  }),
  example({
    id: "example-unbounded-retry",
    number: 108,
    title: "Poll until the draft is ready",
    extraPaths: ["src/jobs/pull.test.ts"],
    files: [
      changed(
        "src/jobs/pull.ts",
        "export async function pullUntilReady(url: string) {\n  while (true) {\n    const response = await fetch(url);\n    if (response.ok) return response;\n  }\n}\n",
      ),
    ],
    expected: [{ bugClass: "unbounded-retry", path: "src/jobs/pull.ts", symbol: "while" }],
  }),
  example({
    id: "example-untested-behavior",
    number: 109,
    title: "Schedule a draft on publish",
    files: [
      changed(
        "src/drafts/publish.ts",
        'export function publishStatus() {\n  return "scheduled";\n}\n',
        'export function publishStatus() {\n  return "draft";\n}\n',
      ),
    ],
    expected: [{ bugClass: "untested-behavior", path: "src/drafts/publish.ts", symbol: "publishStatus" }],
  }),
  example({
    id: "example-deleted-test",
    number: 110,
    title: "Drop the title characterization",
    files: [
      changed(
        "src/drafts/title.test.ts",
        'test("keeps the id", () => {\n  expect(idOf(draft)).toBe("1");\n});\n',
        'test("keeps the title", () => {\n  expect(titleOf(draft)).toBe("Note");\n});\n\ntest("keeps the id", () => {\n  expect(idOf(draft)).toBe("1");\n});\n',
      ),
    ],
    expected: [{ bugClass: "test-deleted", path: "src/drafts/title.test.ts", symbol: "keeps the title" }],
  }),
  example({
    id: "example-pull-request-target",
    number: 111,
    title: "Run CI on pull requests",
    files: [
      changed(
        ".github/workflows/ci.yml",
        `name: ci
on:
  pull_request_target:
    types: [opened]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`,
      ),
    ],
    expected: [
      {
        bugClass: "pull-request-target",
        path: ".github/workflows/ci.yml",
        symbol: "pull_request_target",
      },
    ],
  }),
  example({
    id: "example-prose-trap",
    number: 112,
    title: "Warn about injection in the security notes",
    files: [
      changed(
        "docs/security.md",
        "# Security notes\n\nDo not call eval(userInput) or exec(`rm ${path}`).\nA query like SELECT * FROM t WHERE id = ${id} is how injections start.\n",
        "# Security notes\n",
      ),
    ],
    expected: [],
    shouldNotFlag: [
      { bugClass: "eval-injection", path: "docs/security.md" },
      { bugClass: "command-injection", path: "docs/security.md" },
      { bugClass: "sql-injection", path: "docs/security.md" },
    ],
  }),
  example({
    id: "example-comment-only",
    number: 113,
    title: "Clarify the label helper",
    extraPaths: ["src/drafts/label.test.ts"],
    files: [
      changed(
        "src/drafts/label.ts",
        'export function label() {\n  // bug: looks scary but it is only a note\n  return "draft";\n}\n',
        'export function label() {\n  return "draft";\n}\n',
      ),
    ],
    expected: [],
    shouldNotFlag: [{ bugClass: "comment-mention", path: "src/drafts/label.ts" }],
  }),
  example({
    id: "example-missing-timeout",
    number: 114,
    title: "Notify the ledger",
    extraPaths: ["src/billing/notify.test.ts"],
    files: [
      changed(
        "src/billing/notify.ts",
        'export async function notifyLedger(id: string) {\n  const response = await fetch("https://ledger.internal/notify/" + id);\n  return response.ok;\n}\n',
      ),
    ],
    expected: [{ bugClass: "missing-timeout", path: "src/billing/notify.ts", symbol: "fetch" }],
  }),
  example({
    id: "example-flag-argument",
    number: 115,
    title: "Book a premium or regular slot",
    extraPaths: ["src/billing/book.test.ts"],
    files: [
      changed(
        "src/billing/book.ts",
        "export function book(customer: string, isPremium: boolean) {\n  if (isPremium) return premiumBook(customer);\n  return regularBook(customer);\n}\n",
      ),
    ],
    expected: [{ bugClass: "boolean-mode-parameter", path: "src/billing/book.ts", symbol: "isPremium" }],
  }),
  example({
    id: "example-open-transaction",
    number: 116,
    title: "Move a draft between folders",
    extraPaths: ["src/billing/transfer.test.ts"],
    files: [
      changed(
        "src/billing/transfer.ts",
        'export async function transferDraft(db: Db, id: string) {\n  await db.begin();\n  await db.query("UPDATE drafts SET moved = 1 WHERE id = ?", [id]);\n}\n',
      ),
    ],
    expected: [{ bugClass: "transaction-without-commit", path: "src/billing/transfer.ts", symbol: "begin" }],
  }),
  example({
    id: "example-unsafe-html",
    number: 117,
    title: "Preview rendered draft HTML",
    extraPaths: ["src/app/preview.test.ts"],
    files: [
      changed(
        "src/app/preview.tsx",
        "export function Preview({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n",
      ),
    ],
    expected: [{ bugClass: "unsafe-html", path: "src/app/preview.tsx", symbol: "dangerouslySetInnerHTML" }],
  }),
  example({
    id: "example-command-injection",
    number: 118,
    title: "Zip a draft for export",
    extraPaths: ["src/jobs/export.test.ts"],
    files: [
      changed(
        "src/jobs/export.ts",
        "import { exec } from \"child_process\";\n\nexport function exportDraft(name: string) {\n  exec(`zip drafts/${name}.zip drafts/${name}`);\n}\n",
      ),
    ],
    expected: [{ bugClass: "command-injection", path: "src/jobs/export.ts", symbol: "exec" }],
  }),
  example({
    id: "example-tautology",
    number: 119,
    title: "Add a test for the label",
    files: [
      changed(
        "src/label.test.ts",
        'test("covers the label", () => {\n  expect(true).toBe(true);\n});\n',
      ),
    ],
    expected: [{ bugClass: "assertion-tautology", path: "src/label.test.ts", symbol: "expect" }],
  }),
  example({
    id: "example-missing-telemetry",
    number: 120,
    title: "Rethrow ledger failures",
    extraPaths: ["src/billing/api/notify.test.ts"],
    files: [
      changed(
        "src/billing/api/notify.ts",
        "export async function notifyLedger(id: string) {\n  try {\n    return await deliver(id);\n  } catch (error) {\n    throw error;\n  }\n}\n",
      ),
    ],
    expected: [{ bugClass: "missing-telemetry", path: "src/billing/api/notify.ts", symbol: "notifyLedger" }],
  }),
  example({
    id: "example-untrusted-author",
    number: 121,
    title: "Greet the reader",
    author: "outside-contributor",
    authorTrusted: false,
    extraPaths: ["src/greet.test.ts"],
    files: [
      changed(
        "src/greet.ts",
        "export function greeting(name: string) {\n  return `Hello, ${name}`;\n}\n",
      ),
    ],
    expected: [],
  }),
  example({
    id: "example-round-cap",
    number: 122,
    title: "Charge a card and keep iterating",
    body: "Three review rounds, then the desk refuses a fourth.",
    extraPaths: ["src/billing/charge.test.ts"],
    files: [changed("src/billing/charge.ts", chargeRound1)],
    followUps: [
      {
        headSha: "head-example-round-cap-r2",
        repoPaths: ["src/billing/charge.ts", "src/billing/charge.test.ts"],
        files: [changed("src/billing/charge.ts", chargeRound2)],
      },
      {
        headSha: "head-example-round-cap-r3",
        repoPaths: ["src/billing/charge.ts", "src/billing/charge.test.ts"],
        files: [changed("src/billing/charge.ts", chargeRound3)],
      },
    ],
    expected: [{ bugClass: "swallowed-error", path: "src/billing/charge.ts", symbol: "chargeCard" }],
  }),
];
