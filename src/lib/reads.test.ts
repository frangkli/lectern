import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";

const dir = await mkdtemp(join(tmpdir(), "lectern-reads-"));
afterAll(() => rm(dir, { recursive: true }));
process.env.XDG_STATE_HOME = dir;
const { lastRead, markedAt, markRead } = await import("./reads");

const doc = join(dir, "a.md");
// Saves the document a minute after the last save, and returns its version, as the page stamps it: the
// mtime rounded to the millisecond, like the index's data-mtime. The .6 ms tells rounding from truncating.
let saves = 0;
const save = async (text: string) => {
  await writeFile(doc, text);
  const at = Date.UTC(2026, 0, 1, 0, ++saves) + 0.6;
  await utimes(doc, at / 1000, at / 1000);
  return Math.round(at);
};
const baseline = async () => {
  const read = await lastRead(doc);
  return read && { text: await readFile(read.file, "utf8"), unread: read.unread };
};

test("only a version you mark moves the baseline, and only while it is still on disk", async () => {
  expect(await markRead(doc, await save("read"))).toBe(true);
  // Marked now, not when the fixture saved it.
  expect(Math.abs((await markedAt(doc))! - Date.now())).toBeLessThan(60_000);
  const draft = await save("draft");
  expect(await markedAt(doc)).toBeUndefined();
  const final = await save("final");
  expect(await markRead(doc, draft)).toBe(false);
  expect(await baseline()).toEqual({ text: "read", unread: true });
  expect(await markRead(doc, final)).toBe(true);
  expect(await markRead(doc, final)).toBe(true);
  expect(await baseline()).toEqual({ text: "read", unread: false });
  await save("next draft");
  expect(await baseline()).toEqual({ text: "final", unread: true });
});

test("two marks of the same version at once keep the read before it", async () => {
  const before = await save("before");
  await markRead(doc, before);
  const both = await save("both");
  expect(await Promise.all([markRead(doc, both), markRead(doc, both)])).toEqual([true, true]);
  await save("after");
  expect(await baseline()).toEqual({ text: "both", unread: true });
  await save("both");
  expect(await baseline()).toEqual({ text: "before", unread: false });
});
