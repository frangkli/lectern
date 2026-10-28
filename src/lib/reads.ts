// The copies of a document as you read it, for "changes since you last read it". Each document keeps
// two: the version you read last, and the different one you read before that.
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

// Records the file as read now. Reading an unchanged file again changes nothing.
export async function markRead(file: string) {
  const [last, previous] = copies(file);
  const [current, seen] = await Promise.all([readFile(file, "utf8"), text(last)]);
  if (seen === current) return;
  await mkdir(dir, { recursive: true });
  if (seen !== undefined) await rename(last, previous);
  await writeFile(last, current);
}

// The latest version you read that differs from the file now: its copy, when you read it, and whether
// you have yet to read the current version.
export async function lastRead(file: string) {
  const current = await readFile(file, "utf8");
  for (const [i, copy] of copies(file).entries()) {
    const seen = await text(copy);
    if (seen !== undefined && seen !== current) return { file: copy, mtime: (await stat(copy)).mtimeMs, unread: i === 0 };
  }
  return undefined;
}
