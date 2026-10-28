// The copies of a document as you marked it read, for "changes since you last read it". Each document
// keeps two: the version you marked last, and the different one you marked before that.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { stateDir } from "./config";

const dir = join(stateDir, "read");
const copies = (file: string) => {
  const id = createHash("sha256").update(file).digest("hex").slice(0, 32);
  return ["last", "previous"].map((which) => join(dir, `${id}.${which}${extname(file)}`));
};
const text = (file: string) => readFile(file, "utf8").catch(() => undefined);

// A file's version: its mtime rounded to the millisecond, the rounding the index's data-mtime uses too.
export const versionOf = async (file: string) => Math.round((await stat(file)).mtimeMs);

// Marks the version of the file saved at `version` (versionOf it then) as read. Returns false, marking
// nothing, once the file has changed since, so a save you haven't seen is never marked read.
// Marks of one file run one at a time, so two at once can't both rotate the copies.
const marking = new Map<string, Promise<unknown>>();
export function markRead(file: string, version: number) {
  const done = (marking.get(file) ?? Promise.resolve()).then(() => mark(file, version));
  marking.set(file, done.catch(() => undefined));
  return done;
}
async function mark(file: string, version: number) {
  const [last, previous] = copies(file);
  const [current, seen] = await Promise.all([readFile(file, "utf8"), text(last)]);
  if ((await versionOf(file)) !== version) return false;
  if (seen === current) return true;
  await mkdir(dir, { recursive: true });
  if (seen !== undefined) await rename(last, previous);
  await writeFile(last, current);
  return true;
}

// When you marked the version of the file on disk now as read, if you have.
export async function markedAt(file: string) {
  const [last] = copies(file);
  const [current, seen] = await Promise.all([readFile(file, "utf8"), text(last)]);
  return seen === current ? (await stat(last)).mtimeMs : undefined;
}

// The latest version you marked read that differs from the file now: its copy, when you marked it, and
// whether you have yet to mark the current version.
export async function lastRead(file: string) {
  const current = await readFile(file, "utf8");
  for (const [i, copy] of copies(file).entries()) {
    const seen = await text(copy);
    if (seen !== undefined && seen !== current) return { file: copy, mtime: (await stat(copy)).mtimeMs, unread: i === 0 };
  }
  return undefined;
}
