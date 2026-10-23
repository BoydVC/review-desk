import type { ReviewDepth } from "./types";

export interface Citation {
  title: string;
  authors: string;
  year?: number;
  outlet: string;
  url?: string;
  locator?: string;
}

export interface ExpertCheck {
  bugClass: string;
  summary: string;
  depths: ReviewDepth[];
}

export interface ExpertCard {
  id: string;
  person: string;
  lens: string;
  principle: string;
  /** Whether `principle` is a quotation or the desk's paraphrase. */
  principleKind: "quote" | "paraphrase";
  citations: Citation[];
  depths: ReviewDepth[];
  checks: ExpertCheck[];
}

const all: ReviewDepth[] = ["quick", "standard", "deep"];
const standardUp: ReviewDepth[] = ["standard", "deep"];
const deepOnly: ReviewDepth[] = ["deep"];

export const expertCards: ExpertCard[] = [
  {
    id: "osmani-lunt-wang",
    person: "Addy Osmani, Morgan Westlee Lunt, and Qing Wang",
    lens: "Documentation fails when it lies",
    principle:
      "They say what failure looks like in that repo (for docs it's \"it lies,\" for config it's \"it misroutes\"), cap the nits, list paths to skip, and ask for a file and line as evidence instead of a guess from a name.",
    principleKind: "quote",
    citations: [
      {
        title: "How the Claude Code team does code review",
        authors: "Addy Osmani, Morgan Westlee Lunt, and Qing Wang",
        year: 2026,
        outlet: "claude.dev",
        url: "https://claude.dev/blog/solving-code-review-at-anthropic/",
        locator: "Published October 15, 2026",
      },
      {
        title: "What to look for in a code review",
        authors: "Google eng-practices",
        outlet: "google.github.io",
        url: "https://google.github.io/eng-practices/review/reviewer/looking-for.html",
        locator: "Documentation section",
      },
    ],
    depths: all,
    checks: [
      {
        bugClass: "docs-missing-target",
        summary: "A relative link in the diff points at a file the tree does not contain.",
        depths: all,
      },
      {
        bugClass: "docs-unknown-script",
        summary: "A documented npm script is not in package.json.",
        depths: all,
      },
    ],
  },
  {
    id: "john-ousterhout",
    person: "John Ousterhout",
    lens: "Define special cases out of existence",
    principle:
      "Chapter 10, Define Errors Out of Existence, treats uncommon control-flow as a design smell, and section 10.10, Taking it too far, warns against masking a failure the caller has to know about. Review Desk reads an empty catch around a write, an index that walks off .length, and a || default on a numeric boundary as special cases the diff did not define.",
    principleKind: "paraphrase",
    citations: [
      {
        title: "A Philosophy of Software Design",
        authors: "John Ousterhout",
        year: 2021,
        outlet: "Yaknyam Press",
        locator: "2nd edition, Chapter 10",
      },
    ],
    depths: all,
    checks: [
      {
        bugClass: "swallowed-error",
        summary: "A new catch around a write discards the failure.",
        depths: all,
      },
      {
        bugClass: "off-by-one",
        summary: "A loop index uses <= length.",
        depths: all,
      },
      {
        bugClass: "falsy-default",
        summary: "A numeric boundary uses ||, so 0 is treated as missing.",
        depths: all,
      },
    ],
  },
  {
    id: "adam-shostack",
    person: "Adam Shostack",
    lens: "STRIDE on the diff",
    principle:
      "Read the change as a threat model. Spoofing shows up as a mutating route with no authentication check, tampering as a query or command built from untrusted text, information disclosure as a live secret in the diff, and elevation of privilege as a workflow that checks out pull-request head code under pull_request_target.",
    principleKind: "paraphrase",
    citations: [
      {
        title: "Threat Modeling: Designing for Security",
        authors: "Adam Shostack",
        year: 2014,
        outlet: "Wiley",
        locator: "STRIDE, as used in the book. The mnemonic itself comes from Microsoft.",
      },
    ],
    depths: all,
    checks: [
      { bugClass: "hardcoded-secret", summary: "A live credential is assigned in the diff.", depths: all },
      { bugClass: "sql-injection", summary: "SQL is built with string interpolation.", depths: all },
      { bugClass: "command-injection", summary: "exec is called with a shell string built from data.", depths: all },
      { bugClass: "eval-injection", summary: "eval or new Function runs on added code.", depths: all },
      { bugClass: "unsafe-html", summary: "HTML is injected with no sanitizer in the file.", depths: all },
      { bugClass: "missing-auth", summary: "A new POST handler never checks the caller.", depths: standardUp },
      {
        bugClass: "pull-request-target",
        summary: "pull_request_target checks out the PR head.",
        depths: standardUp,
      },
    ],
  },
  {
    id: "hyrum-wright",
    person: "Hyrum Wright",
    lens: "Observable behavior is the contract",
    principle:
      "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody.",
    principleKind: "quote",
    citations: [
      {
        title: "Hyrum's Law",
        authors: "Hyrum Wright",
        outlet: "hyrumslaw.com",
        url: "https://www.hyrumslaw.com/",
        locator:
          "The site does not display a publication date. Titus Winters named the observation. The sentence above is quoted from the page.",
      },
      {
        title: "Software Engineering at Google",
        authors: "Titus Winters, Tom Manshreck, and Hyrum Wright",
        year: 2020,
        outlet: "O'Reilly",
        locator: "Chapter 1 discusses the law",
      },
    ],
    depths: standardUp,
    checks: [
      {
        bugClass: "removed-export",
        summary: "An exported name disappears from the tree.",
        depths: standardUp,
      },
    ],
  },
  {
    id: "michael-nygard",
    person: "Michael Nygard",
    lens: "Stability patterns, not unbounded failure",
    principle:
      "Timeouts and a cap on retries are how a caller stays alive when a dependency is not. A loop that can fetch forever, a transaction that never commits, and a call with no deadline are the stability antipatterns those patterns exist to stop.",
    principleKind: "paraphrase",
    citations: [
      {
        title: "Release It! Design and Deploy Production-Ready Software",
        authors: "Michael T. Nygard",
        year: 2018,
        outlet: "Pragmatic Bookshelf",
        locator: "2nd edition, Chapter 4 (stability antipatterns) and Chapter 5 (stability patterns)",
      },
    ],
    depths: standardUp,
    checks: [
      { bugClass: "unbounded-retry", summary: "A retry loop has no attempt cap and no break.", depths: standardUp },
      { bugClass: "transaction-without-commit", summary: "A transaction begins and never commits or rolls back.", depths: standardUp },
      { bugClass: "missing-timeout", summary: "A new fetch has no deadline in the surrounding function.", depths: deepOnly },
    ],
  },
  {
    id: "michael-feathers",
    person: "Michael Feathers",
    lens: "Legacy code is code without tests",
    principle:
      "To me, legacy code is simply code without tests. Code without tests is bad code. It doesn't matter how well written it is; it doesn't matter how pretty or object-oriented or well-encapsulated it is. With tests, we can change the behavior of our code quickly and verifiably. Without them, we really don't know if our code is getting better or worse.",
    principleKind: "quote",
    citations: [
      {
        title: "Working Effectively with Legacy Code",
        authors: "Michael C. Feathers",
        year: 2004,
        outlet: "Prentice Hall",
        locator: "Preface, p. xvi",
      },
    ],
    depths: standardUp,
    checks: [
      { bugClass: "untested-behavior", summary: "Control flow changed and the module has no test file.", depths: standardUp },
      { bugClass: "test-deleted", summary: "A named test disappeared from the diff.", depths: standardUp },
      { bugClass: "assertion-tautology", summary: "A new assertion compares a constant to itself.", depths: standardUp },
    ],
  },
  {
    id: "sandi-metz",
    person: "Sandi Metz",
    lens: "Prefer duplication over the wrong abstraction",
    principle:
      "duplication is far cheaper than the wrong abstraction",
    principleKind: "quote",
    citations: [
      {
        title: "The Wrong Abstraction",
        authors: "Sandi Metz",
        year: 2016,
        outlet: "sandimetz.com",
        url: "https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction",
        locator:
          "January 20, 2016. The post also says: prefer duplication over the wrong abstraction. The line began in her RailsConf 2014 talk.",
      },
      {
        title: "Flag Argument",
        authors: "Martin Fowler",
        year: 2011,
        outlet: "martinfowler.com",
        url: "https://martinfowler.com/bliki/FlagArgument.html",
        locator: "June 23, 2011. Quoted there: a flag argument tells the function to carry out a different operation depending on its value.",
      },
    ],
    depths: deepOnly,
    checks: [
      {
        bugClass: "boolean-mode-parameter",
        summary: "A new boolean parameter switches the function between two operations.",
        depths: deepOnly,
      },
    ],
  },
  {
    id: "charity-majors",
    person: "Charity Majors",
    lens: "A failure you cannot see is a failure you will not debug",
    principle:
      "Observability is how well you can understand a system's internal state from its outputs. A new failure path that rethrows and emits no log, metric, or span gives the next incident nothing to query.",
    principleKind: "paraphrase",
    citations: [
      {
        title: "Observability Engineering",
        authors: "Charity Majors, Liz Fong-Jones, and George Miranda",
        year: 2022,
        outlet: "O'Reilly",
      },
    ],
    depths: deepOnly,
    checks: [
      {
        bugClass: "missing-telemetry",
        summary: "A service-boundary catch rethrows with no log, metric, or span.",
        depths: deepOnly,
      },
    ],
  },
];

export function cardById(id: string | null): ExpertCard | undefined {
  if (!id) return undefined;
  return expertCards.find((card) => card.id === id);
}

export function cardsForDepth(depth: ReviewDepth): ExpertCard[] {
  return expertCards.filter((card) => card.depths.includes(depth));
}
