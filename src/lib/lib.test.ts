import { describe, expect, test } from "vitest";
import { loadLanguages } from "./code";
import { diffHtml } from "./diff";
import { linkSources, markdown, parseDocument, withHeadingIds } from "./document";
import { ago, marks } from "./format";
import { type Doc, type Repo, type Worktree, route, unique } from "./library";
import { search } from "./search";

const worktree = (key: string, main = false): Worktree => ({ dir: `/repos/app/${key}`, key, label: key, url: `/app/${key}`, main });
const doc = (fields: Partial<Doc>): Doc => ({
  repo: "app", worktree: worktree("main", true), path: "docs/a.md", place: "app", title: "", summary: "", text: "",
  date: "", kind: "note", mtime: 0, merged: true, decisions: [], ...fields,
});

describe("markdown", () => {
  test("shows raw HTML as text", () => {
    expect(markdown("<script>alert(1)</script>\n")).not.toContain("<script>");
  });
  test("turns GitHub alerts into the kit's callouts and leaves other quotes alone", () => {
    expect(markdown("> [!WARNING]\n> Mind the **gap**.\n")).toContain('<blockquote class="callout risk">\n<p><strong class="callout-title">Warning</strong> Mind the <strong>gap</strong>.</p>\n</blockquote>');
    expect(markdown("> [!TIP]\n> Try this.\n")).toContain('<blockquote class="callout recommend">');
    expect(markdown("> Just a quote.\n")).toContain("<blockquote>\n<p>Just a quote.");
  });
  test("keeps callouts and code titles in a document with non-ASCII text", async () => {
    const source = '> [!NOTE]\n> Café − déjà vu.\n\n```ts title="naïve.ts"\nconst s = "—";\n```\n';
    await loadLanguages(source);
    const html = markdown(source);
    expect(html).toContain('<blockquote class="callout">\n<p><strong class="callout-title">Note</strong> Café − déjà vu.</p>');
    expect(html).toContain("<figcaption>naïve.ts</figcaption>");
  });
  test("highlights code on the server, with a title and marked lines", async () => {
    const source = '```ts title="src/a.ts" {2}\nconst a = 1;\nconst b = 2;\n```\n\n```zzz\nplain\n```\n';
    await loadLanguages(source);
    const html = markdown(source);
    expect(html).toContain('<figure class="lectern-code"><figcaption>src/a.ts</figcaption><pre class="shiki');
    expect(html).toMatch(/<span class="line highlighted">.*const.*b/);
    expect(html).toContain('<pre><code class="language-zzz">plain');
  });
  test("shows a numbered list in an IMPORTANT alert as the kit's decisions, with defaults", () => {
    expect(markdown("> [!IMPORTANT]\n> 1. Keep the path?\n>    Default: yes, for 30 days.\n> 2. Drop it?\n")).toBe(
      '<ol class="decisions">\n<li>Keep the path?<span class="default">Default: yes, for 30 days.</span></li>\n<li>Drop it?</li>\n</ol>\n',
    );
    expect(markdown("> [!IMPORTANT]\n> Read this first.\n")).toContain('<blockquote class="callout decision">');
  });
  test("turns mermaid fences into diagrams and wraps tables", () => {
    expect(markdown("```mermaid\ngraph TD\n```\n")).toContain('<pre class="mermaid">graph TD');
    expect(markdown("| a |\n|---|\n| 1 |\n")).toMatch(/^<div class="scroll"><table>/);
  });
});

describe("parseDocument", () => {
  test("reads Markdown front matter, else the first heading and paragraph", () => {
    expect(parseDocument("---\ntitle: Plan A\nkind: plan\n---\nBody.", "a.md")).toMatchObject({ title: "Plan A", kind: "plan", summary: "Body." });
    expect(parseDocument("# Heading\n\n- a list\n\nThe **first** paragraph.", "a.md")).toMatchObject({ title: "Heading", summary: "The first paragraph." });
  });
  test("lists the decisions a document leaves open, in Markdown or the kit's HTML", () => {
    const md = "# Plan\n\n> [!IMPORTANT]\n> 1. Keep **the** path?\n>    Default: yes.\n> 2. Drop it?\n\n> [!IMPORTANT]\n> Not a list.\n";
    expect(parseDocument(md, "a.md").decisions).toEqual([{ question: "Keep the path?", default: "yes." }, { question: "Drop it?", default: undefined }]);
    const html = '<h1>Plan</h1><ol class="decisions"><li>Ship it?<span class="default">Default: yes, behind a flag.</span></li></ol>';
    expect(parseDocument(html, "a.html").decisions).toEqual([{ question: "Ship it?", default: "yes, behind a flag." }]);
  });
  test("reads an HTML document's title, kind and lede", () => {
    const html = '<title>Spec B</title><meta name="doc-kind" content="spec"><h1>Spec B</h1><p class="eyebrow">Spec</p><p>The lede &amp; more.</p>';
    expect(parseDocument(html, "b.html")).toMatchObject({ title: "Spec B", kind: "spec", summary: "The lede & more." });
  });
});

describe("withHeadingIds", () => {
  test("adds GitHub's ids, keeps existing ones and leaves component headings out of the contents", () => {
    const { html, headings } = withHeadingIds('<h2>Intro</h2><h2>Intro</h2><h2>A &amp; B</h2><h3 id="kept">Kept</h3><div class="callout"><h3>Inside</h3></div>');
    expect(html).toContain('<h2 id="intro-1">Intro</h2>');
    expect(headings.map((h) => h.id)).toEqual(["intro", "intro-1", "a--b", "kept"]);
  });
});

describe("route", () => {
  const repos = new Map<string, Repo>([
    ["app", { name: "app", dir: "/repos/app", worktrees: [worktree("main", true), worktree("feat/x")], local: { ...worktree("~local"), local: true } }],
  ]);
  test("finds a branch with slashes, local docs and links into removed worktrees", () => {
    expect(route("/app/feat/x/docs/plans/a.md", repos)).toMatchObject({ worktree: { key: "feat/x" }, path: "docs/plans/a.md" });
    expect(route("/app/~local/b.md", repos)).toMatchObject({ worktree: { key: "~local" }, path: "b.md" });
    expect(route("/app/gone/docs/c.md", repos)).toMatchObject({ worktree: undefined, path: "docs/c.md" });
  });
  test("refuses paths outside the doc folders", () => {
    expect(route("/app/main/docs/../secret.md", repos).path).toBeUndefined();
    expect(route("/app/main/src/index.ts", repos).path).toBeUndefined();
    expect(route("/app/~local/../x.md", repos).path).toBeUndefined();
    expect(route("/app/~local/.hidden.md", repos).path).toBeUndefined();
  });
});

test("unique lists a merged doc once, preferring the main checkout's copy", () => {
  const docs = unique([doc({ worktree: worktree("feat/x") }), doc({ title: "main copy" }), doc({ merged: false, worktree: worktree("feat/x") })]);
  expect(docs.map((d) => [d.title, d.merged])).toEqual([["main copy", true], ["", false]]);
});

test("search needs every term and ranks title matches first", () => {
  const docs = [doc({ path: "docs/1.md", title: "Other", text: "cache cache cache" }), doc({ path: "docs/2.md", title: "Cache plan", text: "cache" })];
  expect(search(docs, "cache").map((r) => r.doc.title)).toEqual(["Cache plan", "Other"]);
  expect(search(docs, "cache missing")).toEqual([]);
});

test("ago and marks", () => {
  const now = new Date(2026, 9, 27, 12).getTime();
  expect([ago(now, now), ago(now - 5 * 6e4, now), ago(now - 864e5, now)]).toEqual(["Just now", "5 min ago", "Yesterday"]);
  expect(marks("A cache plan", ["cache"])).toEqual([{ text: "A ", hit: false }, { text: "cache", hit: true }, { text: " plan", hit: false }]);
});

describe("diffHtml", () => {
  test("marks changed words inside a block, and new or removed blocks whole, removed first", () => {
    const html = diffHtml(markdown("The quick brown fox jumps.\n\nGone here.\n"), markdown("A slow brown fox jumps.\n\nBrand new.\n"));
    expect(html).toBe('<p><del class="lectern-del">The quick</del><ins class="lectern-ins">A slow</ins> brown fox jumps.</p>\n<p class="lectern-del">Gone here.</p>\n<p class="lectern-ins">Brand new.</p>');
  });
  test("keeps a table's columns, drops removed headings' ids and marks code by line", async () => {
    const source = (heading: string, cell: string, line: string) => `${heading}| A | B |\n|---|---|\n| 1 | ${cell} |\n\n\`\`\`ts\nconst a = 1;\n${line}\n\`\`\`\n`;
    await loadLanguages(source("", "", ""));
    const html = diffHtml(withHeadingIds(markdown(source("## Old\n\n", "4", "let b;"))).html, markdown(source("", "5", "let c;")));
    expect(html).toContain('<h2 class="lectern-del">Old</h2>');
    expect(html).toContain('<td><del class="lectern-del">4</del><ins class="lectern-ins">5</ins></td>');
    expect(html).toMatch(/class="line diff remove">.*b;[\s\S]*class="line diff add">.*c;/);
  });
});

test("linkSources links code citing a tracked file, and leaves the rest alone", () => {
  const files = new Set(["src/lib/a.ts", "src/b.ts", "test/b.ts", "README.md"]);
  const html = linkSources(markdown("`src/lib/a.ts:42`, `a.ts:4-6`, `src/b.ts`, `b.ts:1`, `README.md`, `x.ts:1`\n\n```\nsrc/b.ts\n```\n"), files, (path, lines) => `/source/app/main/${path}${lines}`);
  expect(html).toContain('<a class="lectern-src" href="/source/app/main/src/lib/a.ts#L42"><code>src/lib/a.ts:42</code></a>');
  expect(html).toContain('href="/source/app/main/src/lib/a.ts#L4-L6"><code>a.ts:4-6</code>');
  expect(html).toContain('href="/source/app/main/src/b.ts"><code>src/b.ts</code>');
  // Ambiguous, a bare name without a line, unknown, and code blocks stay as written.
  for (const text of ["<code>b.ts:1</code>", "<code>README.md</code>", "<code>x.ts:1</code>", "<pre><code>src/b.ts"]) expect(html).toContain(text);
  expect(html.match(/lectern-src/g)).toHaveLength(3);
});
