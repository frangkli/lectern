// Two renderings of a document merged into one, marked where they differ: blocks that are new or gone
// are marked whole, and a block that changed shows its edits word by word, or line by line for code.
import { diffArrays } from "diff";

const blockTags = new Set("address article aside blockquote caption dd details div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul".split(" "));
const voidTags = new Set("area br col embed hr img input source track wbr".split(" "));
// Comments, scripts and styles are skipped whole, since they may hold "<"; every other tag is a token.
const tags = /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>|<(\/?)([a-zA-Z][\w-]*)[^>]*>/g;

const nameOf = (part: string) => /^<([a-zA-Z][\w-]*)/.exec(part)?.[1].toLowerCase();
const isBlock = (part: string) => blockTags.has(nameOf(part) ?? "");

// The top-level pieces of a fragment: each block element whole, and the inline content between blocks.
// shortcut: assumes well-formed HTML (every non-void tag closed), which Markdown output and the kit's docs are.
function blocks(html: string) {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  let open = false;
  const push = (to: number) => {
    const part = html.slice(from, to).trim();
    if (part) parts.push(part);
    from = to;
  };
  for (const match of html.matchAll(tags)) {
    if (!match[3]) continue;
    const name = match[3].toLowerCase();
    const end = match.index + match[0].length;
    if (depth === 0 && !match[2] && blockTags.has(name)) {
      push(match.index);
      open = true;
    }
    if (voidTags.has(name) || match[0].endsWith("/>")) {
      if (depth === 0 && open) (push(end), (open = false));
      continue;
    }
    depth = Math.max(0, depth + (match[2] ? -1 : 1));
    if (depth === 0 && open) (push(end), (open = false));
  }
  push(html.length);
  return parts;
}

const words = (part: string) => new Set(part.replace(/<[^>]*>/g, " ").toLowerCase().match(/[\p{L}\p{N}]+/gu));
// Share of words two blocks have in common, 0 to 1.
function likeness(a: string, b: string) {
  const [x, y] = [words(a), words(b)];
  if (!x.size && !y.size) return 1;
  return [...x].filter((word) => y.has(word)).length / Math.max(x.size, y.size);
}

// A whole block (or a run of inline content) marked as added or removed. A removed block loses its ids,
// so links and the contents land on the current heading.
function mark(part: string, kind: "ins" | "del") {
  const text = kind === "del" ? part.replace(/\s+id="[^"]*"/g, "") : part;
  if (!isBlock(text)) return `<${kind} class="lectern-${kind}">${text}</${kind}>`;
  const open = /^<[^>]*>/.exec(text)![0];
  const marked = /\sclass="/.test(open) ? open.replace(/\sclass="/, ` class="lectern-${kind} `) : open.replace(/\/?>$/, ` class="lectern-${kind}"$&`);
  return marked + text.slice(open.length);
}

function diffParts(before: string[], after: string[]): string[] {
  const out: string[] = [];
  const changes = diffArrays(before, after);
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change.added && !change.removed) out.push(...change.value);
    else if (change.added) out.push(...change.value.map((part) => mark(part, "ins")));
    else out.push(...pair(change.value, changes[i + 1]?.added ? changes[++i].value : []));
  }
  return out;
}

// Removed and added blocks in one stretch: each added block takes the next removed block of the same
// tag that shares at least half its words (any table cell, so rows keep their columns), and the two are
// diffed inside. The rest are marked whole, removed before added.
function pair(removed: string[], added: string[]) {
  const out: string[] = [];
  let pending: string[] = [];
  let next = 0;
  for (const part of added) {
    const cell = /^t[dh]$/.test(nameOf(part) ?? "");
    const match = removed.findIndex((old, i) => i >= next && nameOf(old) === nameOf(part) && (cell || likeness(old, part) >= 0.5));
    if (match < 0) {
      pending.push(mark(part, "ins"));
      continue;
    }
    out.push(...removed.slice(next, match).map((old) => mark(old, "del")), ...pending, diffBlock(removed[match], part));
    pending = [];
    next = match + 1;
  }
  return [...out, ...removed.slice(next).map((old) => mark(old, "del")), ...pending];
}

const split = (part: string) => {
  const open = /^<[^>]*>/.exec(part)![0];
  const close = new RegExp(`</${nameOf(part)}>$`, "i").exec(part)?.[0] ?? "";
  return { open, inner: part.slice(open.length, part.length - close.length), close };
};

// Two versions of one block. Code compares line by line; a block holding blocks compares those; any
// other block, or inline content, compares word by word.
function diffBlock(before: string, after: string) {
  if (!isBlock(after)) return diffWords(before, after);
  const [a, b] = [split(before), split(after)];
  if (nameOf(after) === "pre") return /\bclass="[^"]*\bshiki\b/.test(b.open) ? diffCode(before, after) : `${mark(before, "del")}\n${mark(after, "ins")}`;
  const children: [string[], string[]] = [blocks(a.inner), blocks(b.inner)];
  if (children.some((parts) => parts.some(isBlock))) return `${b.open}\n${diffParts(...children).join("\n")}\n${b.close}`;
  return b.open + diffWords(a.inner, b.inner) + b.close;
}

// Highlighted code: each line is a span on its own line of the source, so removed lines come back with
// the diff classes Shiki's notation uses, and Lectern styles them the same way.
function diffCode(before: string, after: string) {
  const body = (pre: string) => /^([\s\S]*?<code[^>]*>)([\s\S]*)(<\/code>[\s\S]*)$/.exec(pre);
  const [a, b] = [body(before), body(after)];
  if (!a || !b) return `${mark(before, "del")}\n${mark(after, "ins")}`;
  const lines = diffArrays(a[2].split("\n"), b[2].split("\n")).flatMap((change) =>
    change.value.map((line) => (change.added || change.removed ? line.replace('class="line', `class="line diff ${change.added ? "add" : "remove"}`) : line)),
  );
  return b[1] + lines.join("\n") + b[3];
}

const tokens = (html: string) => html.match(/<[^>]*>|&#?\w+;|[\p{L}\p{N}_]+|\s+|[^<&\s\p{L}\p{N}_]/gu) ?? [];
const isTag = (token: string) => token[0] === "<";
// Whether a run's tags open and close each other, so it can be wrapped whole.
function balanced(run: string[]) {
  let depth = 0;
  for (const token of run.filter(isTag)) {
    if (voidTags.has(nameOf(token) ?? "") || token.endsWith("/>")) continue;
    depth += token[1] === "/" ? -1 : 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
// A changed run: wrapped whole when its tags balance, else its text is wrapped piece by piece and its
// tags are kept for added text (they shape the current version) and dropped for removed text.
function wrap(run: string[], kind: "ins" | "del") {
  if (!run.length) return "";
  if (balanced(run)) return `<${kind} class="lectern-${kind}">${run.join("")}</${kind}>`;
  let out = "";
  let text = "";
  const flush = () => ((out += text && `<${kind} class="lectern-${kind}">${text}</${kind}>`), (text = ""));
  for (const token of run) {
    if (!isTag(token)) text += token;
    else (flush(), kind === "ins" && (out += token));
  }
  flush();
  return out;
}

// Inline HTML compared word by word. A space between two edits joins them, so "the quick" to "a slow"
// reads as one replacement rather than two.
function diffWords(before: string, after: string) {
  const changes = diffArrays(tokens(before), tokens(after));
  let out = "";
  let removed: string[] = [];
  let added: string[] = [];
  changes.forEach((change, i) => {
    const between = !change.added && !change.removed && i > 0 && i < changes.length - 1 && change.value.every((token) => !token.trim());
    if (change.removed || between) removed.push(...change.value);
    if (change.added || between) added.push(...change.value);
    if (change.added || change.removed || between) return;
    out += wrap(removed, "del") + wrap(added, "ins") + change.value.join("");
    removed = [];
    added = [];
  });
  return out + wrap(removed, "del") + wrap(added, "ins");
}

// The document's content (what sits in <main>, or the whole fragment) with its changes since `before` marked.
export function diffHtml(before: string, after: string) {
  return diffParts(blocks(before), blocks(after)).join("\n");
}
