import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDiffFolder, parseGitDiff } from "@/lib/review/gitdiff";
import { openSession } from "@/lib/review/pipeline";

const sample = path.join(process.cwd(), "fixtures", "samples", "unified");

describe("unified diff import", () => {
  it("parses a new file, a rename, and a deletion", () => {
    const files = parseGitDiff(`diff --git a/src/fresh.ts b/src/fresh.ts
new file mode 100644
index 0000000..aaaaaaa
--- /dev/null
+++ b/src/fresh.ts
@@ -0,0 +1,2 @@
+export const n = 1;
+
diff --git "a/old name.ts" "b/new name.ts"
similarity index 100%
rename from old name.ts
rename to new name.ts
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index bbbbbbb..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const gone = true;
`);
    expect(files.map((file) => [file.status, file.path])).toEqual([
      ["added", "src/fresh.ts"],
      ["renamed", "new name.ts"],
      ["deleted", "src/gone.ts"],
    ]);
    expect(files[0]?.content).toContain("export const n = 1");
    expect(files[0]?.partial).toBe(true);
  });

  it("keeps the off-by-one in the sample and does not invent a missing doc target", async () => {
    const loaded = loadDiffFolder(sample);
    expect(loaded.cases).toHaveLength(1);
    const item = loaded.cases[0]!;
    expect(item.groundTruth).toBe(false);
    expect(item.pr.treeComplete).toBe(false);
    expect(item.pr.provenance).toBe("imported");
    expect(item.pr.repo).toBe("BoydVC/draft-day");
    const session = await openSession(item.pr);
    expect(session.findings.map((finding) => finding.bugClass)).toEqual(["off-by-one"]);
  });

  it("resolves pr-01_<suffix>.diff when the index names pr-01.diff", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "review-desk-diffs-"));
    writeFileSync(
      path.join(dir, "index_b18c.json"),
      JSON.stringify([
        {
          number: 7,
          title: "Suffix name",
          diff_file: "pr-07.diff",
          head: "h",
          base: "b",
        },
      ]),
    );
    writeFileSync(
      path.join(dir, "pr-07_abcd.diff"),
      `diff --git a/src/only.ts b/src/only.ts
index 1111111..2222222 100644
--- a/src/only.ts
+++ b/src/only.ts
@@ -1 +1 @@
-export const a = 1;
+export const a = 2;
`,
    );
    const loaded = loadDiffFolder(dir);
    expect(loaded.indexName).toBe("index_b18c.json");
    expect(loaded.cases[0]?.pr.files[0]?.path).toBe("src/only.ts");
  });
});
