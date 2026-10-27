import type { Doc } from "./library";
import { localRoot } from "./library";

// Every kind Lectern knows, in the order it lists them: [one, many]. Any other kind lists after these.
const kinds: Record<string, [string, string]> = {
  plan: ["Plan", "Plans"], spec: ["Spec", "Specs"], research: ["Research", "Research"],
  explainer: ["Explainer", "Explainers"], tradeoff: ["Tradeoff", "Tradeoffs"],
  experiment: ["Experiment", "Experiments"], review: ["Review", "Reviews"], note: ["Note", "Notes"],
};
const known = (kind: string) => Object.hasOwn(kinds, kind);
export const kindName = (kind: string, many = false) => (known(kind) ? kinds[kind][many ? 1 : 0] : kind[0].toUpperCase() + kind.slice(1));
export const kindsIn = (docs: Doc[]) => {
  const present = new Set(docs.map((doc) => doc.kind));
  return [...new Set([...Object.keys(kinds), ...present])].filter((kind) => present.has(kind));
};

export const drafts = (docs: Doc[]) => docs.filter((doc) => !doc.merged).length;
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export const statusOf = (doc: Doc) => (doc.local ? "local" : doc.merged ? "merged" : "draft");
// Where a document sits, as its own folder shows it.
export const shownPath = (doc: Doc) => (doc.worktree.key === "~notes" ? `notes/${doc.path}` : doc.local ? `${localRoot}/${doc.path}` : doc.path);

export const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const daysAgo = (ms: number, now = Date.now()) => Math.round((dayStart(now) - dayStart(ms)) / 864e5);
const shortDate = (ms: number, now = Date.now()) => {
  const date = new Date(ms);
  const year = date.getFullYear() === new Date(now).getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${months[date.getMonth()].slice(0, 3)} ${date.getDate()}${year}`;
};
export const ago = (ms: number, now = Date.now()) => {
  const minutes = Math.max(0, Math.round((now - ms) / 6e4));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (daysAgo(ms, now) === 0) return `${Math.round(minutes / 60)} h ago`;
  return daysAgo(ms, now) === 1 ? "Yesterday" : shortDate(ms, now);
};
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const stamp = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
// A day's heading: its name, then its date.
export const dayHeading = (ms: number, now = Date.now()) => {
  const date = new Date(ms);
  const days = daysAgo(ms, now);
  const full = `${months[date.getMonth()]} ${date.getDate()}${date.getFullYear() === new Date(now).getFullYear() ? "" : `, ${date.getFullYear()}`}`;
  if (days <= 0) return ["Today", `${weekdays[date.getDay()]}, ${full}`];
  if (days === 1) return ["Yesterday", `${weekdays[date.getDay()]}, ${full}`];
  return days < 7 ? [weekdays[date.getDay()], full] : [full, weekdays[date.getDay()]];
};

// Splits text into plain and matched parts, for marking search terms.
export function marks(text: string, terms: string[]) {
  if (!terms.length) return [{ text, hit: false }];
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, i) => ({ text: part, hit: i % 2 === 1 }));
}
