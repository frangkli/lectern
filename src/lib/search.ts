import { statusOf } from "./format";
import { type Doc, unique } from "./library";

// Every term must appear in the title, the location, the kind, the status or the text. Title and
// location matches rank first, then how often the terms occur.
export function search(docs: Doc[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: { doc: Doc; score: number; snippet?: string }[] = [];
  for (const doc of unique(docs)) {
    const title = doc.title.toLowerCase();
    const where = `${doc.place} ${doc.kind} ${statusOf(doc)}`.toLowerCase();
    const text = doc.text.toLowerCase();
    if (!terms.every((term) => title.includes(term) || where.includes(term) || text.includes(term))) continue;
    const score = terms.reduce(
      (sum, term) => sum + (title.includes(term) ? 20 : 0) + (where.includes(term) ? 10 : 0) + Math.min(text.split(term).length - 1, 25),
      0,
    );
    const at = text.indexOf(terms[0]);
    const start = Math.max(0, at - 80);
    // Markdown's emphasis and code marks would show as symbols, so they go.
    const plain = doc.text.slice(start, at + 180).replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
    const snippet = at < 0 ? undefined : `${start > 0 ? "…" : ""}${plain}…`;
    results.push({ doc, score, snippet });
  }
  return results.toSorted((a, b) => b.score - a.score || b.doc.mtime - a.doc.mtime);
}
