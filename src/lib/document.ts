import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import GithubSlugger from "github-slugger";
import { defineMdastPlugin, markdownToHtml } from "satteri";
import { codeBlock, loadLanguages } from "./code";
import { kitFile } from "./config";

export const escapeHtml = (text: string) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };
const decodeHtml = (html: string) => html.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (m, dec, hex, name) => (dec || hex ? String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)) : (entities[name] ?? m)));
export const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&(\w+);/g, (m, name) => entities[name] ?? m).replace(/\s+/g, " ").trim();

function frontMatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const fields: Record<string, string> = Object.fromEntries([...(match?.[1] ?? "").matchAll(/^(\w+):\s*["']?(.*?)["']?\s*$/gm)].map((m) => m.slice(1)));
  return { fields, body: match ? source.slice(match[0].length) : source };
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
    return { title: stripTags(title ?? ""), kind, summary: clip(stripTags(lede ?? "")), text: stripTags(body) };
  }
  const { fields, body } = frontMatter(source);
  const prose = body.replace(/^```[\s\S]*?^```/gm, "").split(/\n\s*\n/).find((block) => /^\s*[\p{L}*_`[(]/u.test(block) && !/^\s*([-*+] |\d+[.)] |\|)/.test(block));
  const summary = (prose ?? "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  return { title: fields.title || /^# (.+)$/m.exec(body)?.[1] || "", kind: fields.kind, summary: clip(fields.description || summary), text: body };
}

// Raw HTML in a Markdown document shows as text, so a document can never run code in Lectern.
const rawHtmlAsText = defineMdastPlugin({
  name: "raw-html-as-text",
  html(node, ctx) {
    ctx.replaceNode(node, { type: "text", value: node.value });
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

// CommonMark with GitHub's extensions, through Sätteri. Code is highlighted, alerts become callouts,
// Mermaid fences become diagrams, and wide tables scroll inside the column. Call loadLanguages first.
export const markdown = (source: string) =>
  callouts(markdownToHtml(source, { features: { gfm: true }, mdastPlugins: [rawHtmlAsText, codeBlocks] }).html)
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, '<pre class="mermaid">$1</pre>')
    .replace(/<table>[\s\S]*?<\/table>/g, '<div class="scroll">$&</div>');

// The kit's CSS or script, read from the visual-doc template so Lectern matches every document.
export async function kit(tag: "style" | "script") {
  const template = await readFile(kitFile, "utf8").catch(() => "");
  return new RegExp(`<${tag} id="kit(?:-js)?">([\\s\\S]*?)</${tag}>`).exec(template)?.[1] ?? "";
}

// The offsets of the h2 and h3 that sit inside a component (a card, phase, tab, callout, figure or
// details). Their titles name parts of a figure, not sections, so they stay out of the contents list.
// Comments, styles and scripts are skipped, since the kit's own comments mention tags.
const componentClass = /\bclass="[^"]*\b(arch|box|phases|decisions|tabs|flow|callout|metrics|stack)\b/;
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

// A document as the browser gets it: Markdown rendered with the kit, every heading linkable. An HTML
// document carries a copy of the kit from when it was written; it gets the current one instead.
export async function documentHtml(file: string) {
  const source = await readFile(file, "utf8");
  const [style, script] = await Promise.all([kit("style"), kit("script"), loadLanguages(source)]);
  if (extname(file) !== ".md") {
    // Code the author wrote as <pre><code class="language-…"> is highlighted like Markdown's.
    const html = source.replace(/<pre>\s*<code class="language-([\w+-]+)">([^<]*)<\/code>\s*<\/pre>/g, (block, lang, code) => codeBlock(decodeHtml(code), lang) ?? block);
    // Without a kit to serve (the template is missing), the document keeps its own.
    if (!style) return withHeadingIds(html);
    return withHeadingIds(html
      .replace(/(<style id="kit">)[\s\S]*?(<\/style>)/, (_, open, close) => open + style + close)
      .replace(/(<script id="kit-js">)[\s\S]*?(<\/script>)/, (_, open, close) => open + script + close));
  }
  const { fields, body } = frontMatter(source);
  const title = escapeHtml(fields.title || /^# (.+)$/m.exec(body)?.[1] || basename(file));
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`;
  return withHeadingIds(`<!doctype html><html lang="en"><head>${head}<style>${style}</style></head><body><main>${markdown(body)}</main><script>${script}</script></body></html>`);
}
