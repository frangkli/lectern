import { transformerMetaHighlight, transformerNotationDiff, transformerNotationHighlight } from "@shikijs/transformers";
import { type BundledLanguage, bundledLanguages, createHighlighter } from "shiki";
import { escapeHtml } from "./document";

// One highlighter for the server's life, in GitHub's light and dark colours (the kit's code colours).
// Languages load on first use; see loadLanguages.
const highlighter = await createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
const known = (lang: string): lang is BundledLanguage => Object.hasOwn(bundledLanguages, lang);

// Loads every language a document's code blocks name, so highlighting during the render stays synchronous.
export async function loadLanguages(source: string) {
  const langs = new Set([...source.matchAll(/^\s*(?:```|~~~)\s*([\w+-]+)|class="language-([\w+-]+)"/gm)].map((m) => (m[1] ?? m[2]).toLowerCase()));
  await highlighter.loadLanguage(...[...langs].filter(known));
}

// A code block as highlighted HTML, or undefined when its language isn't loaded. The info string after
// the language can carry title="…" and line ranges such as {2,4-5}; `// [!code ++]`, `[!code --]` and
// `[!code highlight]` comments mark lines too.
export function codeBlock(code: string, lang: string, meta = "") {
  lang = lang.toLowerCase();
  if (!known(lang) || !highlighter.getLoadedLanguages().includes(lang)) return undefined;
  const pre = highlighter.codeToHtml(code.replace(/\n$/, ""), {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    meta: { __raw: meta },
    transformers: [transformerMetaHighlight(), transformerNotationDiff(), transformerNotationHighlight()],
  });
  const title = /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta);
  if (!title) return pre;
  return `<figure class="lectern-code"><figcaption>${escapeHtml(title[1] ?? title[2] ?? title[3])}</figcaption>${pre}</figure>`;
}

// A whole file as highlighted HTML, each line linkable as #L<n> (lectern.css numbers them). The language comes from
// the extension, or the file name for files like Dockerfile; anything else shows as plain text.
export async function sourceHtml(code: string, name: string) {
  const ext = /\.([\w+-]+)$/.exec(name)?.[1].toLowerCase() ?? name.toLowerCase();
  const lang = known(ext) ? ext : "text";
  if (lang !== "text") await highlighter.loadLanguage(lang);
  return highlighter.codeToHtml(code.replace(/\n$/, ""), {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    transformers: [{
      line(node, line) {
        node.properties.id = `L${line}`;
      },
    }],
  });
}
