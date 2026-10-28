import { readFile } from "node:fs/promises";
import { basename, extname, posix } from "node:path";
import GithubSlugger from "github-slugger";
import { defineMdastPlugin, markdownToHtml } from "satteri";
import { codeBlock, loadLanguages } from "./code";
import script from "../scripts/kit.js?raw";
import style from "../styles/kit.css?raw";

export const escapeHtml = (text: string) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };
const decodeHtml = (html: string) => html.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (m, dec, hex, name) => {
  const n = dec ? Number(dec) : parseInt(hex, 16);
  return name ? (entities[name] ?? m) : n > 0x10ffff ? m : String.fromCodePoint(n);
});
export const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&(\w+);/g, (m, name) => entities[name] ?? m).replace(/\s+/g, " ").trim();

function frontMatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const fields: Record<string, string> = Object.fromEntries([...(match?.[1] ?? "").matchAll(/^(\w+):\s*["']?(.*?)["']?\s*$/gm)].map((m) => m.slice(1)));
  return { fields, body: match ? source.slice(match[0].length) : source };
}

export interface Decision {
  question: string;
  default?: string;
}

// The decisions a document leaves to its reader: the kit's <ol class="decisions"> in HTML, and in
// Markdown a numbered list inside a > [!IMPORTANT] alert. An item's "Default:" part is its default.
function decisionsIn(source: string, html: boolean): Decision[] {
  const decision = (text: string) => {
    const [question, value] = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`/g, "").split(/\s*\bDefault:\s*/);
    return { question: question.trim(), default: value?.trim() || undefined };
  };
  if (html) return [...source.matchAll(/<ol class="decisions">([\s\S]*?)<\/ol>/g)].flatMap((list) => [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((item) => decision(stripTags(item[1]))));
  const decisions: Decision[] = [];
  for (const block of source.matchAll(/^>[ \t]*\[!IMPORTANT\][ \t]*\n((?:>.*(?:\n|$))*)/gim)) {
    let item: string | undefined;
    for (const line of block[1].split("\n").map((line) => line.replace(/^>[ \t]?/, ""))) {
      const start = /^\d+[.)]\s+(.*)$/.exec(line);
      if (start && item !== undefined) decisions.push(decision(item));
      if (start) item = start[1];
      else if (item !== undefined && line.trim()) item += ` ${line.trim()}`;
    }
    if (item !== undefined) decisions.push(decision(item));
  }
  return decisions;
}

// Title, kind, summary and searchable text. Kind comes from <meta name="doc-kind"> or `kind:` front
// matter. The summary is the lede, else the first paragraph after the title.
export function parseDocument(source: string, path: string) {
  const clip = (text: string) => (text.length > 280 ? `${text.slice(0, 280).replace(/\s+\S*$/, "")}…` : text);
  if (path.endsWith(".html")) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source)?.[1];
    const kind = /<meta name="doc-kind" content="([^"]+)"/i.exec(source)?.[1];
    const body = source.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ");
    const afterTitle = body.slice(Math.max(0, body.search(/<\/h1>/i)));
    const lede = /<p\b[^>]*\blede\b[^>]*>([\s\S]*?)<\/p>/i.exec(body)?.[1] ?? /<p(?![^>]*\beyebrow\b)[^>]*>([\s\S]*?)<\/p>/i.exec(afterTitle)?.[1];
    return { title: stripTags(title ?? ""), kind, summary: clip(stripTags(lede ?? "")), text: stripTags(body), decisions: decisionsIn(source, true) };
  }
  const { fields, body } = frontMatter(source);
  const prose = body.replace(/^```[\s\S]*?^```/gm, "").split(/\n\s*\n/).find((block) => /^\s*[\p{L}*_`[(]/u.test(block) && !/^\s*([-*+] |\d+[.)] |\|)/.test(block));
  const summary = (prose ?? "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  return { title: fields.title || /^# (.+)$/m.exec(body)?.[1] || "", kind: fields.kind, summary: clip(fields.description || summary), text: body, decisions: decisionsIn(body, false) };
}

// Raw HTML in a Markdown document shows as text, so a document can never run code in Lectern. The one
// exception is a collapsed section: a block opening with <details> (or <details open>) and its plain-text
// <summary>, and a </details> that ends it. An opening tag without its summary can only be inline, so stays text.
const collapsed = /^(?:<details(?: open)?>\s*<summary>[^<]*<\/summary>|<\/details>)$/;
const rawHtmlAsText = defineMdastPlugin({
  name: "raw-html-as-text",
  html(node, ctx) {
    if (!collapsed.test(node.value.trim())) ctx.replaceNode(node, { type: "text", value: node.value });
  },
});

// Fenced code, highlighted on the server (see code.ts). It runs after rawHtmlAsText, so the HTML it
// writes stays HTML. Mermaid stays for the kit to draw.
const codeBlocks = defineMdastPlugin({
  name: "code-blocks",
  code(node, ctx) {
    const html = node.lang && node.lang !== "mermaid" && codeBlock(node.value, node.lang, node.meta ?? "");
    if (html) ctx.replaceNode(node, { type: "html", value: html });
  },
});

// GitHub's alerts (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]) become the kit's callouts:
// a note plain, a tip green, something important ochre like a decision, a warning or caution red.
// This reads the rendered HTML because Sätteri 0.11.1 misreads text nodes in any document with a
// non-ASCII character.
const alerts: Record<string, [string, string]> = {
  note: ["Note", "callout"], tip: ["Tip", "callout recommend"], important: ["Important", "callout decision"],
  warning: ["Warning", "callout risk"], caution: ["Caution", "callout risk"],
};
const callouts = (html: string) =>
  html.replace(/<blockquote>\n<p>\[!(note|tip|important|warning|caution)\](?:[ \t]*<\/p>\n<p>|[ \t]*\n|[ \t]+)?/gi, (_, kind: string) => {
    const [title, className] = alerts[kind.toLowerCase()];
    return `<blockquote class="${className}">\n<p><strong class="callout-title">${title}</strong> `;
  });

// A > [!IMPORTANT] alert that holds a numbered list is the reader's decisions, shown as the kit's
// decisions list with each "Default:" line as the item's default. Runs before callouts.
const decisionLists = (html: string) =>
  html.replace(/<blockquote>\n<p>\[!IMPORTANT\]<\/p>\n<ol>([\s\S]*?)<\/ol>\n<\/blockquote>/gi, (_, items: string) =>
    `<ol class="decisions">${items
      .replace(/<p>Default:\s*([\s\S]*?)<\/p>/g, '<span class="default">Default: $1</span>')
      .replace(/\nDefault:\s*([\s\S]*?)(<\/p>\s*)?(?=<\/li>)/g, '<span class="default">Default: $1</span>$2')}</ol>`);

// CommonMark with GitHub's extensions, through Sätteri. Code is highlighted, alerts become callouts,
// Mermaid fences become diagrams, and wide tables scroll inside the column. Call loadLanguages first.
export const markdown = (source: string) =>
  callouts(decisionLists(markdownToHtml(source, { features: { gfm: true }, mdastPlugins: [rawHtmlAsText, codeBlocks] }).html))
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<pre class="mermaid">$1</pre>')
    .replace(/<table>[\s\S]*?<\/table>/g, '<div class="scroll">$&</div>');

// Code an HTML document wrote as <pre><code class="language-…">, highlighted like Markdown's. The <pre>'s
// data-title and data-lines="2,4-5" stand in for a fence's title="…" and {2,4-5}. Call loadLanguages first.
export const htmlCodeBlocks = (html: string) =>
  html.replace(/<pre((?:\s+data-(?:title|lines)="[^"]*")*)\s*>\s*<code class="language-([\w+-]+)">([^<]*)<\/code>\s*<\/pre>/g, (block, attrs: string, lang: string, code: string) => {
    const title = /data-title="([^"]*)"/.exec(attrs)?.[1];
    const lines = /data-lines="([^"]*)"/.exec(attrs)?.[1].replace(/[^\d,-]/g, "");
    return codeBlock(decodeHtml(code), lang, lines ? `{${lines}}` : "", title && decodeHtml(title)) ?? block;
  });

// Lectern's copy of the kit: styles Markdown, index pages, and HTML documents that carry a kit of their own.
// It started as visual-doc's and may drift from it, but it must keep styling the classes those documents use.
export const kit = { style, script };

// The offsets of the h2 and h3 that sit inside a component (a card, phase, tab, callout, figure or
// details). Their titles name parts of a figure, not sections, so they stay out of the contents list.
// Comments, styles and scripts are skipped, since the kit's own comments mention tags.
const componentClass = /\bclass="[^"]*\b(arch|box|phases|decisions|findings|tabs|flow|callout|metrics|stack)\b/;
function nestedHeadings(html: string) {
  const skipped = [...html.matchAll(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>/gi)].map((m) => [m.index, m.index + m[0].length]);
  const nested = new Set<number>();
  const open: boolean[] = [];
  for (const match of html.matchAll(/<(\/?)(div|section|ol|ul|details|figure|aside|h[23])\b([^>]*)>/gi)) {
    if (skipped.some(([from, to]) => match.index >= from && match.index < to)) continue;
    const [, close, name, attributes] = match;
    const tag = name.toLowerCase();
    if (tag[0] === "h") {
      if (!close && open.includes(true)) nested.add(match.index);
    } else if (close) {
      open.pop();
    } else {
      open.push(/^(details|figure|aside)$/.test(tag) || componentClass.test(attributes));
    }
  }
  return nested;
}

export interface Heading {
  level: string;
  id: string;
  text: string;
}

// Gives every h2 and h3 an id (keeping existing ones), for deep links, and lists the section headings
// for the contents. Tags and badges inside a heading stay out of its text.
export function withHeadingIds(html: string) {
  const used = new Set<string>();
  // GitHub's ids, so a #link written against GitHub's rendering lands on the same heading here.
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  const nested = nestedHeadings(html);
  const out = html.replace(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, attributes, inner, offset) => {
    const text = stripTags(inner.replace(/<(span|small)\b[^>]*class="[^"]*\b(tag|badge)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ""));
    let id = /\sid="([^"]+)"/i.exec(attributes)?.[1];
    if (!id) {
      do id = slugger.slug(text) || "section";
      while (used.has(id));
      match = `<h${level}${attributes} id="${id}">${inner}</h${level}>`;
    }
    used.add(id);
    if (!nested.has(offset)) headings.push({ level, id, text });
    return match;
  });
  return { html: out, headings };
}

// A repo's tracked files, where a citation of one links to, and dir, the citing document's folder in it.
export interface Sources {
  files: Set<string>;
  href: (path: string, lines: string) => string;
  dir?: string;
}

// The repo names cited as `repo:path`, for linkSources' others.
export const citedRepos = (html: string) => new Set([...html.matchAll(/<code>([^<:/]+):[^<]/g)].map((m) => m[1]));

// Inline code citing a file in the document's repo, like `src/a.ts:42`, `a.ts:40-52` or `src/a.ts`,
// becomes a link: href gets the tracked path and the "#L40-L52" lines, if any. A path matches a tracked
// file exactly, or as the end of exactly one tracked path; anything else stays as written. A citation
// prefixed with one of others' repo names, like `lectern:src/a.ts:42`, resolves in that repo instead.
export function linkSources(html: string, own: Sources | undefined, others: ReadonlyMap<string, Sources> = new Map()) {
  return html.replace(/(?<!<(?:pre|a)\b[^>]*>\s*)<code>([^<]+)<\/code>/g, (match, text: string) => {
    const [, prefix, rest] = /^([^:/]+):(.+)$/.exec(text) ?? [];
    const [sources, cited] = prefix && others.has(prefix) ? [others.get(prefix), rest] : [own, text];
    const [, path, from, to] = /^([\w.@+-][\w./@+-]*)(?::(\d+)(?:-(\d+))?)?$/.exec(cited) ?? [];
    if (!sources || !path || (!from && !path.includes("/"))) return match;
    // A path starting ./ or ../ is relative to dir, the document's folder; ./ may also mean the repo's root.
    const { files, href, dir = "" } = sources;
    const bare = path.replace(/^\.\//, "");
    const exact = [/^\.\.?\//.test(path) && posix.join(dir, path), bare].find((candidate) => candidate && files.has(candidate));
    const matches = exact ? [exact] : [...files].filter((file) => file.endsWith(`/${bare}`));
    if (matches.length !== 1) return match;
    // The link shows the file's name and lines, and the full citation on hover, so a long path doesn't crowd the line.
    const label = `${posix.basename(path)}${from ? `:${from}${to ? `-${to}` : ""}` : ""}`;
    return `<a class="lectern-src" href="${href(matches[0], from ? `#L${from}${to ? `-L${to}` : ""}` : "")}" title="${text}"><code>${label}</code></a>`;
  });
}

// An HTML document's kit, swapped for Lectern's: a copy pasted in as <style id="kit"> and <script id="kit-js">,
// or a link to the installed skill's files as <link id="kit"> and <script id="kit-js" src>. A page without them keeps its own styles.
export const withKit = (html: string) =>
  html
    .replace(/<style id="kit">[\s\S]*?<\/style>|<link\b[^>]*\sid="kit"[^>]*>/, () => `<style id="kit">${style}</style>`)
    .replace(/<script\b[^>]*\sid="kit-js"[^>]*>[\s\S]*?<\/script>/, () => `<script id="kit-js">${script}</script>`);

// A document as the browser gets it: Markdown rendered with the kit, every heading linkable. An HTML
// document carries or links a kit from when it was written; it gets Lectern's instead.
export async function documentHtml(file: string) {
  const source = await readFile(file, "utf8");
  await loadLanguages(source);
  if (extname(file) !== ".md") return withHeadingIds(withKit(htmlCodeBlocks(source)));
  const { fields, body } = frontMatter(source);
  const title = escapeHtml(fields.title || /^# (.+)$/m.exec(body)?.[1] || basename(file));
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`;
  return withHeadingIds(`<!doctype html><html lang="en"><head>${head}<style>${style}</style></head><body><main>${markdown(body)}</main><script>${script}</script></body></html>`);
}
