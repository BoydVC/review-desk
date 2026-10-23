import type { ExpertCard } from "./experts";
import { cardsForDepth } from "./experts";
import type { CandidateFinding, ReviewedFile } from "./types";
import type { ReviewDepth } from "./types";
import {
  catchBlocks,
  enclosingFunction,
  isCodePath,
  isMarkdown,
  isSwallowedCatch,
  isTestPath,
  lineIsCodeComment,
  testPathsFor,
} from "./text";

export interface HuntContext {
  depth: ReviewDepth;
  files: ReviewedFile[];
  tree: string[];
  /** False when the tree is only the paths in this diff. */
  treeComplete: boolean;
  packageJson?: string;
  activeCardIds: string[];
}

export interface ReviewAgent {
  id: string;
  name: string;
  expertCardId: string | null;
  hunt(ctx: HuntContext): Promise<CandidateFinding[]>;
}

function finding(
  agent: ReviewAgent,
  file: ReviewedFile,
  line: number,
  evidence: string,
  fields: Omit<CandidateFinding, "agentId" | "expertCardId" | "path" | "line" | "evidence">,
): CandidateFinding {
  return {
    agentId: agent.id,
    expertCardId: agent.expertCardId,
    path: file.path,
    line,
    evidence: evidence.trim(),
    ...fields,
  };
}

function added(file: ReviewedFile, predicate: (text: string) => boolean) {
  return file.added.filter((line) => predicate(line.text) && !lineIsCodeComment(line.text, file.path));
}

function cardOn(ctx: HuntContext, id: string): boolean {
  return ctx.activeCardIds.includes(id);
}

const SENSITIVE_WRITE = /\b(charge|refund|withdraw|transfer|publish|capture)\b/;

export const docsHunter: ReviewAgent = {
  id: "docs-hunter",
  name: "Docs hunter",
  expertCardId: "osmani-lunt-wang",
  async hunt(ctx) {
    if (!cardOn(ctx, "osmani-lunt-wang")) return [];
    const found: CandidateFinding[] = [];
    const tree = new Set(ctx.tree);
    for (const file of ctx.files) {
      if (!isMarkdown(file.path)) continue;
      const base = file.path.split("/").slice(0, -1);
      if (ctx.treeComplete) {
      for (const line of file.added) {
        for (const match of line.text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const target = resolveDocTarget(base, match[1]);
          if (!target) continue;
          if (treeHas(tree, target)) continue;
          found.push(
            finding(docsHunter, file, line.line, line.text, {
              symbol: target,
              title: `README target ${target} is not in the tree`,
              body: `The new link points at ${target}, and that path is not in the repository tree or in this diff. A doc that names a file the tree does not contain is a doc that lies.`,
              severity: "important",
              category: "docs",
              bugClass: "docs-missing-target",
            }),
          );
        }
      }
      }
      if (!ctx.packageJson) continue;
      let scripts: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(ctx.packageJson) as { scripts?: Record<string, unknown> };
        scripts = parsed.scripts ?? {};
      } catch {
        continue;
      }
      for (const line of file.added) {
        for (const match of line.text.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
          const script = match[1];
          if (script in scripts) continue;
          found.push(
            finding(docsHunter, file, line.line, line.text, {
              symbol: script,
              title: `Documented script ${script} is not in package.json`,
              body: `The diff tells a reader to run npm run ${script}, and package.json has no such script.`,
              severity: "important",
              category: "docs",
              bugClass: "docs-unknown-script",
            }),
          );
        }
      }
    }
    return found;
  },
};

function resolveDocTarget(base: string[], raw: string): string | null {
  const clean = raw.trim();
  if (!clean || clean.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  const pathOnly = clean.split("#")[0]?.split("?")[0] ?? "";
  if (!pathOnly || pathOnly.endsWith("/")) return null;
  const stack = [...base];
  for (const part of pathOnly.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function treeHas(tree: Set<string>, target: string): boolean {
  if (tree.has(target)) return true;
  const prefix = `${target}/`;
  for (const path of tree) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

export const boundsHunter: ReviewAgent = {
  id: "bounds-hunter",
  name: "Bounds hunter",
  expertCardId: "john-ousterhout",
  async hunt(ctx) {
    if (!cardOn(ctx, "john-ousterhout")) return [];
    const found: CandidateFinding[] = [];
    for (const file of ctx.files) {
      if (!isCodePath(file.path) || isTestPath(file.path) || isMarkdown(file.path)) continue;
      const source = file.content;
      if (SENSITIVE_WRITE.test(source)) {
        for (const block of catchBlocks(source)) {
          if (!file.added.some((line) => line.line === block.line)) continue;
          if (!isSwallowedCatch(block.body)) continue;
          const symbol = enclosingFunction(source, block.line);
          found.push(
            finding(boundsHunter, file, block.line, block.header, {
              symbol,
              title: `${symbol} swallows a failure the caller has to know about`,
              body: "The new catch discards an error on a write. Masking that failure makes the special case disappear for the caller, which is the move Ousterhout warns is taking it too far.",
              severity: "important",
              category: "bug",
              bugClass: "swallowed-error",
            }),
          );
        }
      }
      for (const line of added(file, (text) => /for\s*\(/.test(text) && /<=\s*[\w.]+\.length\s*;/.test(text))) {
        const symbol = /<=\s*([\w.]+)\.length/.exec(line.text)?.[1] ?? "length";
        found.push(
          finding(boundsHunter, file, line.line, line.text, {
            symbol,
            title: `Loop walks one past ${symbol}.length`,
            body: `The new loop uses <= ${symbol}.length, so the last index is past the end of the collection.`,
            severity: "important",
            category: "bug",
            bugClass: "off-by-one",
          }),
        );
      }
      for (const line of added(
        file,
        (text) =>
          /\b(limit|offset|count|index|page|qty|quantity|retries|port)\s*=\s*[A-Za-z0-9_$.?()[\]]+\s*\|\|/.test(
            text,
          ),
      )) {
        const symbol =
          /\b(limit|offset|count|index|page|qty|quantity|retries|port)\s*=/.exec(line.text)?.[1] ??
          "value";
        found.push(
          finding(boundsHunter, file, line.line, line.text, {
            symbol,
            title: `${symbol} treats 0 as missing`,
            body: `The new default uses ||. A legitimate 0 collapses to the fallback. A nullish default (??) keeps the boundary defined.`,
            severity: "important",
            category: "bug",
            bugClass: "falsy-default",
          }),
        );
      }
    }
    return found;
  },
};

const PLACEHOLDER = /example|placeholder|changeme|your[-_ ]|xxxx+|todo|fake|dummy|sample|\$\{/i;
const LIVE_SECRET = /\b(sk-live-|sk-ant-|ghp_|github_pat_|AKIA[0-9A-Z]{16}|xox[baprs]-)/;
const SECRET_ASSIGN =
  /\b(api[_-]?key|apikey|secret|password|token|private[_-]?key)\b\s*[:=]\s*['"]([^'"]{8,})['"]/i;

export const strideHunter: ReviewAgent = {
  id: "stride-hunter",
  name: "STRIDE hunter",
  expertCardId: "adam-shostack",
  async hunt(ctx) {
    if (!cardOn(ctx, "adam-shostack")) return [];
    const found: CandidateFinding[] = [];
    const deepEnough = ctx.depth !== "quick";
    for (const file of ctx.files) {
      if (isMarkdown(file.path) || isTestPath(file.path) || isDataPayload(file.path)) continue;
      for (const line of added(file, () => true)) {
        const secret = secretOnLine(line.text, file.path);
        if (secret) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: secret,
              title: `Live credential assigned to ${secret}`,
              body: "The diff assigns a credential literal. That is information disclosure: the value is now in history even if a later commit deletes it.",
              severity: "important",
              category: "security",
              bugClass: "hardcoded-secret",
            }),
          );
        }
        if (isSqlInjection(line.text)) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: "query",
              title: "SQL is built by interpolating data",
              body: "The new query concatenates or interpolates a value into SQL. A bound parameter keeps the data out of the statement.",
              severity: "important",
              category: "security",
              bugClass: "sql-injection",
            }),
          );
        }
        if (isCommandInjection(line.text)) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: "exec",
              title: "Shell command is built from data",
              body: "exec is called with a string that interpolates data. A shell will parse whatever landed in that string.",
              severity: "important",
              category: "security",
              bugClass: "command-injection",
            }),
          );
        }
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(line.text)) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: "eval",
              title: "eval executes added text as code",
              body: "The diff adds eval or new Function. That is code injection waiting for a caller.",
              severity: "important",
              category: "security",
              bugClass: "eval-injection",
            }),
          );
        }
      }
      if (
        file.added.some((line) => line.text.includes("dangerouslySetInnerHTML")) &&
        !/DOMPurify|sanitize/.test(file.content)
      ) {
        const line = file.added.find((item) => item.text.includes("dangerouslySetInnerHTML"));
        if (line && !lineIsCodeComment(line.text, file.path)) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: "dangerouslySetInnerHTML",
              title: "HTML is injected with no sanitizer in the file",
              body: "dangerouslySetInnerHTML writes markup straight into the DOM, and this file never sanitizes it.",
              severity: "important",
              category: "security",
              bugClass: "unsafe-html",
            }),
          );
        }
      }
      if (deepEnough && isMutatingRoute(file) && !hasAuthCheck(file.content)) {
        const line = file.added.find((item) => /function\s+POST\b|\.post\s*\(/.test(item.text));
        if (line) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: "POST",
              title: "Mutating handler does not check the caller",
              body: "This POST handler writes data and never checks a session, token, or authorization header. That is a spoofing gap.",
              severity: "important",
              category: "security",
              bugClass: "missing-auth",
            }),
          );
        }
      }
      if (
        deepEnough &&
        file.path.includes(".github/workflows") &&
        /pull_request_target/.test(file.content) &&
        /checkout/.test(file.content) &&
        /github\.event\.pull_request\.head/.test(file.content) &&
        file.added.some((line) =>
          /pull_request_target|github\.event\.pull_request\.head/.test(line.text),
        )
      ) {
        const line =
          file.added.find((item) => /pull_request_target/.test(item.text)) ??
          file.added.find((item) => /github\.event\.pull_request\.head/.test(item.text));
        if (line) {
          found.push(
            finding(strideHunter, file, line.line, line.text, {
              symbol: "pull_request_target",
              title: "Workflow checks out pull-request head under pull_request_target",
              body: "pull_request_target runs with the base repository's privileges. Checking out the PR head in that job runs untrusted code with those privileges.",
              severity: "important",
              category: "security",
              bugClass: "pull-request-target",
            }),
          );
        }
      }
    }
    return found;
  },
};

function isDataPayload(filePath: string): boolean {
  return /\.(json|jsonl|csv|txt|svg|png|lock)$/i.test(filePath);
}

function isTestHelper(filePath: string): boolean {
  return isTestPath(filePath) || filePath.includes("/test/") || filePath.includes("/tests/") || filePath.includes("/fixtures/");
}

function secretOnLine(text: string, filePath: string): string | null {
  const assigned = SECRET_ASSIGN.exec(text);
  const named =
    assigned && !PLACEHOLDER.test(assigned[2]) && !text.includes("process.env") ? assigned[1] : null;
  const live = LIVE_SECRET.test(text) && !PLACEHOLDER.test(text) && !text.includes("process.env");
  if (isTestHelper(filePath) && !live) return null;
  if (named) return named;
  if (live) return "secret";
  return null;
}

function isSqlInjection(text: string): boolean {
  const statement =
    /\bselect\b[\s\S]{0,80}\bfrom\b/i.test(text) ||
    /\binsert\s+into\b/i.test(text) ||
    /\bupdate\b[\s\S]{0,40}\bset\b/i.test(text) ||
    /\bdelete\s+from\b/i.test(text);
  if (!statement) return false;
  return /\$\{/.test(text) || /['"`]\s*\+|\+\s*['"`]/.test(text);
}

function isCommandInjection(text: string): boolean {
  if (!/(?<![\w.])exec(?:Sync)?\s*\(/.test(text)) return false;
  if (/(?<![\w.])execFile(?:Sync)?\s*\(/.test(text)) return false;
  return /\$\{|\+/.test(text);
}

function isMutatingRoute(file: ReviewedFile): boolean {
  const route =
    /\/(route|handler)\.(ts|js|tsx|jsx)$/.test(file.path) ||
    file.path.includes("/api/") ||
    file.path.includes("pages/api/");
  if (!route) return false;
  return file.added.some((line) => /export\s+(async\s+)?function\s+POST\b|\.post\s*\(/.test(line.text));
}

function hasAuthCheck(source: string): boolean {
  return /\b(auth|session|requireUser|currentUser|isAuthorized|verifyToken|getServerSession|authorization|clerk)\b/i.test(
    source,
  );
}

export const compatHunter: ReviewAgent = {
  id: "compat-hunter",
  name: "Compat hunter",
  expertCardId: "hyrum-wright",
  async hunt(ctx) {
    if (!cardOn(ctx, "hyrum-wright")) return [];
    const found: CandidateFinding[] = [];
    const stillExported = new Set<string>();
    for (const file of ctx.files) {
      for (const name of exportedNames(file.content)) stillExported.add(name);
    }
    for (const file of ctx.files) {
      if (isTestPath(file.path) || isMarkdown(file.path)) continue;
      const removedNames = [...exportedNames(file.previousContent)].filter(
        (name) => !exportedNames(file.content).has(name) && !stillExported.has(name),
      );
      for (const name of removedNames) {
        const line = file.removed.find((item) => item.text.includes(name) && item.text.includes("export"));
        if (!line) continue;
        found.push(
          finding(compatHunter, file, line.line, line.text, {
            symbol: name,
            title: `Exported ${name} disappeared`,
            body: `${name} was part of the observable surface and this diff removes it. Callers can depend on it whether or not the contract mentioned it.`,
            severity: "important",
            category: "compat",
            bugClass: "removed-export",
          }),
        );
      }
    }
    return found;
  },
};

export function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).trim().replace(/^type\s+/, "");
      if (name && name !== "default") names.add(name);
    }
  }
  return names;
}

export const stabilityHunter: ReviewAgent = {
  id: "stability-hunter",
  name: "Stability hunter",
  expertCardId: "michael-nygard",
  async hunt(ctx) {
    if (!cardOn(ctx, "michael-nygard")) return [];
    const found: CandidateFinding[] = [];
    for (const file of ctx.files) {
      if (!isCodePath(file.path) || isTestPath(file.path)) continue;
      const lines = file.content.split("\n");
      for (const line of added(file, (text) => /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(text))) {
        const window = lines.slice(line.line - 1, line.line + 35).join("\n");
        const callsOut = /\bfetch\s*\(|\baxios\b|\brequest\s*\(/.test(window);
        const capped =
          /\bbreak\b|maxAttempts|maxRetries|MAX_|attempt\s*>=|attempts\s*>=|attempt\s*>/.test(window);
        if (callsOut && !capped) {
          found.push(
            finding(stabilityHunter, file, line.line, line.text, {
              symbol: "while",
              title: "Retry loop can run forever",
              body: "The new loop calls the network and has no attempt cap and no break. A stuck dependency keeps this caller busy.",
              severity: "important",
              category: "reliability",
              bugClass: "unbounded-retry",
            }),
          );
        }
      }
      const begins = added(file, (text) => /\.begin\s*\(|\bstartTransaction\s*\(/.test(text));
      if (begins.length > 0 && !/\b(commit|rollback)\b/.test(file.content)) {
        const line = begins[0];
        found.push(
          finding(stabilityHunter, file, line.line, line.text, {
            symbol: "begin",
            title: "Transaction begins and never commits or rolls back",
            body: "The diff opens a transaction and the file never commits or rolls it back. The connection stays checked out.",
            severity: "important",
            category: "reliability",
            bugClass: "transaction-without-commit",
          }),
        );
      }
      if (ctx.depth === "deep") {
        for (const line of added(file, (text) => /\bfetch\s*\(/.test(text))) {
          const start = Math.max(0, line.line - 12);
          const window = lines.slice(start, line.line + 12).join("\n");
          if (/timeout|AbortSignal|signal\s*:/.test(window)) continue;
          found.push(
            finding(stabilityHunter, file, line.line, line.text, {
              symbol: "fetch",
              title: "Outbound fetch has no deadline",
              body: "The new fetch has no timeout or abort signal in the surrounding lines. A hung peer hangs this caller.",
              severity: "important",
              category: "reliability",
              bugClass: "missing-timeout",
            }),
          );
          break;
        }
      }
    }
    return found;
  },
};

export const testsHunter: ReviewAgent = {
  id: "tests-hunter",
  name: "Tests hunter",
  expertCardId: "michael-feathers",
  async hunt(ctx) {
    if (!cardOn(ctx, "michael-feathers")) return [];
    const found: CandidateFinding[] = [];
    const tree = new Set(ctx.tree);
    for (const file of ctx.files) {
      if (isTestPath(file.path)) {
        const previousNames = testNames(file.previousContent);
        const nextNames = new Set(testNames(file.content));
        for (const name of previousNames) {
          if (nextNames.has(name)) continue;
          const line = file.removed.find((item) => item.text.includes(name));
          if (!line) continue;
          found.push(
            finding(testsHunter, file, line.line, line.text, {
              symbol: name,
              title: `Test "${name}" was deleted`,
              body: "A named test disappeared. Without it, the behavior it pinned can move and nobody will see the failure.",
              severity: "important",
              category: "tests",
              bugClass: "test-deleted",
            }),
          );
        }
        for (const line of added(file, (text) => /expect\(\s*(true|false|0|1)\s*\)\s*\.to(Be|Equal)\(\s*\1\s*\)/.test(text))) {
          found.push(
            finding(testsHunter, file, line.line, line.text, {
              symbol: "expect",
              title: "Assertion compares a constant to itself",
              body: "The new assertion cannot fail when the code under test breaks. A test that cannot fail is not a characterization.",
              severity: "important",
              category: "tests",
              bugClass: "assertion-tautology",
            }),
          );
        }
        continue;
      }
      if (!isCodePath(file.path) || isMarkdown(file.path)) continue;
      const behavior = file.added.some(
        (line) =>
          !lineIsCodeComment(line.text, file.path) &&
          /\b(if|return|throw|await|switch)\b/.test(line.text),
      );
      if (!behavior || !ctx.treeComplete) continue;
      const covered = testPathsFor(file.path).some((path) => tree.has(path) || ctx.files.some((item) => item.path === path));
      if (covered) continue;
      const line =
        file.added.find(
          (item) =>
            !lineIsCodeComment(item.text, file.path) &&
            /\b(if|return|throw|await|switch)\b/.test(item.text),
        ) ?? file.added[0];
      if (!line) continue;
      const symbol = enclosingFunction(file.content, line.line);
      found.push(
        finding(testsHunter, file, line.line, line.text, {
          symbol,
          title: `${symbol} changed with no test file in the tree`,
          body: "Control flow changed and the module has no test file. Feathers' working definition of legacy code is code without tests, and this diff adds behavior there.",
          severity: "important",
          category: "tests",
          bugClass: "untested-behavior",
        }),
      );
    }
    return found;
  },
};

function testNames(source: string): string[] {
  return [...source.matchAll(/(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
}

export const abstractionHunter: ReviewAgent = {
  id: "abstraction-hunter",
  name: "Abstraction hunter",
  expertCardId: "sandi-metz",
  async hunt(ctx) {
    if (!cardOn(ctx, "sandi-metz") || ctx.depth !== "deep") return [];
    const found: CandidateFinding[] = [];
    for (const file of ctx.files) {
      if (!isCodePath(file.path) || isTestPath(file.path)) continue;
      for (const line of added(file, (text) => /function\s+\w+\s*\([^)]*:\s*boolean\b/.test(text))) {
        const name = /function\s+(\w+)/.exec(line.text)?.[1] ?? "fn";
        const param = /\b(\w+)\s*:\s*boolean\b/.exec(line.text)?.[1];
        if (!param) continue;
        const window = file.content
          .split("\n")
          .slice(line.line - 1, line.line + 25)
          .join("\n");
        if (!new RegExp(`\\bif\\s*\\(\\s*!?\\s*${param}\\b`).test(window)) continue;
        found.push(
          finding(abstractionHunter, file, line.line, line.text, {
            symbol: param,
            title: `${name} takes a boolean that switches the operation`,
            body: `${param} tells ${name} which operation to run. Metz's warning is that this kind of parameter is how a shared abstraction goes wrong; Fowler's advice is to prefer two methods the caller can read.`,
            severity: "important",
            category: "bug",
            bugClass: "boolean-mode-parameter",
          }),
        );
      }
    }
    return found;
  },
};

const BOUNDARY = /(^|\/)(api|worker|jobs|server|billing)\//;

export const telemetryHunter: ReviewAgent = {
  id: "telemetry-hunter",
  name: "Telemetry hunter",
  expertCardId: "charity-majors",
  async hunt(ctx) {
    if (!cardOn(ctx, "charity-majors") || ctx.depth !== "deep") return [];
    const found: CandidateFinding[] = [];
    for (const file of ctx.files) {
      if (!BOUNDARY.test(file.path) || isTestPath(file.path)) continue;
      for (const block of catchBlocks(file.content)) {
        if (!file.added.some((line) => line.line === block.line)) continue;
        if (!/\bthrow\b/.test(block.body)) continue;
        if (/\b(logger|log|metrics|console|span|trace)\b/.test(block.body)) continue;
        const symbol = enclosingFunction(file.content, block.line);
        found.push(
          finding(telemetryHunter, file, block.line, block.header, {
            symbol,
            title: `${symbol} rethrows with nothing to query later`,
            body: "The new catch on a service boundary rethrows and writes no log, metric, or span. The next failure of this path will not be reconstructable from the outside.",
            severity: "important",
            category: "reliability",
            bugClass: "missing-telemetry",
          }),
        );
      }
    }
    return found;
  },
};

export const nitHunter: ReviewAgent = {
  id: "nit-hunter",
  name: "Nit hunter",
  expertCardId: null,
  async hunt(ctx) {
    const found: CandidateFinding[] = [];
    for (const file of ctx.files) {
      for (const line of file.added) {
        if (!/^\s*(\/\/|#)\s*(TODO|FIXME)\b/.test(line.text)) continue;
        found.push(
          finding(nitHunter, file, line.line, line.text, {
            symbol: "TODO",
            title: "TODO left in the diff",
            body: "Cleanup note. Dropped before the quorum, the same way style and diagnostics are dropped.",
            severity: "nit",
            category: "cleanup",
            bugClass: "todo-comment",
          }),
        );
      }
    }
    return found;
  },
};

/** A deliberately noisy hunter. The quorum panel exists to vote this kind of finding down. */
export const commentBaitHunter: ReviewAgent = {
  id: "comment-bait",
  name: "Comment bait",
  expertCardId: null,
  async hunt(ctx) {
    const found: CandidateFinding[] = [];
    for (const file of ctx.files) {
      if (isMarkdown(file.path)) continue;
      for (const line of file.added) {
        if (!lineIsCodeComment(line.text, file.path)) continue;
        if (!/\bbug\b/i.test(line.text)) continue;
        found.push(
          finding(commentBaitHunter, file, line.line, line.text, {
            symbol: "comment",
            title: "Comment mentions a bug",
            body: "The word bug showed up in a comment. This hunter is noisy on purpose. A comment is not an executable defect, and the panel should vote it down.",
            severity: "nit",
            category: "bug",
            bugClass: "comment-mention",
          }),
        );
      }
    }
    return found;
  },
};

export const allHunters: ReviewAgent[] = [
  docsHunter,
  boundsHunter,
  strideHunter,
  compatHunter,
  stabilityHunter,
  testsHunter,
  abstractionHunter,
  telemetryHunter,
  nitHunter,
  commentBaitHunter,
];

export function huntersFor(depth: ReviewDepth, cards: ExpertCard[] = cardsForDepth(depth)): ReviewAgent[] {
  const active = new Set(cards.map((card) => card.id));
  return allHunters.filter((hunter) => hunter.expertCardId === null || active.has(hunter.expertCardId));
}
