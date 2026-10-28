// The library: every repo's docs/ and internal/docs/, read live from each checkout and worktree
// (unmerged branches included), plus docs that are never committed: each main checkout's docs/local
// folder and the notes folder for docs about no repo.
//
// URLs: /<repo>/<branch>/<path> for committed docs, /<repo>/~local/<path> for local docs and
// /~notes/<path> for notes. Git forbids "~" in branch names, so neither collides with a branch.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, posix, relative, sep } from "node:path";
import { promisify } from "node:util";
import { notesDir, roots } from "./config";
import { type Decision, parseDocument } from "./document";

export interface Worktree {
  dir: string;
  key: string;
  label: string;
  url: string;
  main?: boolean;
  local?: boolean;
  within?: string;
}
export interface Repo {
  name: string;
  dir: string;
  notes?: boolean;
  worktrees: Worktree[];
  local: Worktree;
}
export interface Doc {
  repo: string;
  worktree: Worktree;
  path: string;
  place: string;
  title: string;
  summary: string;
  text: string;
  date: string;
  kind: string;
  mtime: number;
  merged: boolean;
  local?: boolean;
  decisions: Decision[];
}
export interface Library {
  at: number;
  repos: Map<string, Repo>;
  docs: Doc[];
}

const run = promisify(execFile);
// The folders Lectern lists, relative to a checkout. Edit these to add or remove one.
// Committed docs: everything under each of docRoots (internal/docs/ for repos published by an export
// that drops internal/). localRoot is the main checkout's uncommitted folder, listed on its own.
export const docRoots = ["docs", "internal/docs"];
export const localRoot = "docs/local";
// The kind a document gets when it doesn't declare one, from the first folder under its doc root.
const folders: Record<string, string> = { plans: "plan", research: "research", specs: "spec" };

// The longest doc root a path sits under, or undefined.
const rootOf = (path: string) => docRoots.filter((root) => path.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0];
const isDocPath = (path: string) => Boolean(rootOf(path)) && !path.startsWith(`${localRoot}/`) && path.length > rootOf(path).length + 1;
const docPathIn = new RegExp(`(?:^|/)((?:${docRoots.map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})/.*)$`);
const folderKind = (path: string) => {
  const folder = path.slice(rootOf(path).length + 1).split("/")[0];
  return Object.hasOwn(folders, folder) ? folders[folder] : "note";
};

const git = async (dir: string, ...args: string[]) => (await run("git", ["-C", dir, ...args], { maxBuffer: 1 << 26 })).stdout;
export const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
export const docUrl = (doc: Doc) => `${doc.worktree.url}/${encodePath(doc.path)}`;

// Each clone's `git worktree list` finds its worktrees wherever they live, so only the clones
// need to sit under a root. The first repo with a given directory name wins. Each repo also gets its
// main checkout's docs/local folder, and the notes folder, when it exists, becomes the "notes" entry.
async function findRepos() {
  const dirs: string[] = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) dirs.push(join(root, entry.name));
    }
  }
  const outputs = await Promise.all(
    dirs.map((dir) => access(join(dir, ".git")).then(() => git(dir, "worktree", "list", "--porcelain", "-z"), () => "")),
  );
  const repos = new Map<string, Repo>();
  for (const output of outputs) {
    const records = output.split("\0\0").filter(Boolean).map((record) =>
      Object.fromEntries(record.split("\0").map((field) => [field.split(" ", 1)[0], field.slice(field.indexOf(" ") + 1)])),
    );
    const main = records[0]?.worktree;
    const name = main && basename(main).replace(/\.git$/, "");
    if (!name || repos.has(name)) continue;
    const worktrees = records
      .filter((record) => !("bare" in record) && !("prunable" in record))
      .map((record) => {
        const key = record.branch?.replace("refs/heads/", "") ?? `@${basename(record.worktree)}`;
        return { dir: record.worktree, main: record.worktree === main, key, label: key, url: `/${encodePath(name)}/${encodePath(key)}` };
      });
    const local = { dir: join(main, localRoot), within: main, local: true, key: "~local", label: "local", url: `/${encodePath(name)}/~local` };
    repos.set(name, { name, dir: main, worktrees, local });
  }
  if (await stat(notesDir).then((info) => info.isDirectory(), () => false)) {
    const folder = { dir: notesDir, main: true, local: true, key: "~notes", label: "notes", url: "/~notes" };
    repos.set("~notes", { name: "notes", dir: notesDir, notes: true, worktrees: [folder], local: folder });
  }
  return repos;
}

const docBlobs = async (dir: string, commit: string) => {
  const output = await git(dir, "ls-tree", "-r", "-z", commit, "--", ...docRoots);
  return new Map(output.split("\0").filter(Boolean).map((line) => [line.split("\t")[1], line.split(/[ \t]/)[2]]));
};

// The default branch's commit (origin's, else the main checkout's HEAD) and its docs' blob ids.
// Comparing bytes, not just paths, is what marks a merged plan that a branch has since edited as a draft.
async function defaultBranch(dir: string) {
  for (const ref of ["refs/remotes/origin/HEAD", "HEAD"]) {
    const commit = (await git(dir, "rev-parse", "--verify", "-q", `${ref}^{commit}`).catch(() => "")).trim();
    if (commit) return { commit, blobs: await docBlobs(dir, commit) };
  }
  return { commit: undefined, blobs: new Map<string, string>() };
}

// Blob ids where a worktree's branch left the default branch. A file still equal to them came from
// the default branch unchanged, so it isn't the branch's draft even when the default branch has moved on.
async function forkBlobs(dir: string, commit?: string) {
  const base = commit && (await git(dir, "merge-base", "HEAD", commit).catch(() => "")).trim();
  return base ? docBlobs(dir, base) : new Map<string, string>();
}

// A docs folder counts only if its real path stays inside the worktree.
async function folderRoot(worktreeDir: string, folder: string) {
  const [root, dir] = await Promise.all([realpath(worktreeDir), realpath(join(worktreeDir, folder))]).catch(() => []);
  return dir?.startsWith(root + sep) ? dir : undefined;
}

// A worktree's docs, committed or not, minus what .gitignore drops (a docs site's build output or
// node_modules). Git lists a symlinked folder as one entry, so symlinks are never followed.
async function docFiles(dir: string) {
  const output = await git(dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate", "--", ...docRoots).catch(() => "");
  return output.split("\0").filter((path) => /\.(md|html)$/.test(path) && isDocPath(path) && !/(^|\/)\./.test(path));
}

// A folder of uncommitted docs counts only if its real path exists and, for docs/local, stays
// inside the main checkout.
async function flatRoot(folder: Worktree) {
  const [dir, within] = await Promise.all([realpath(folder.dir), folder.within && realpath(folder.within)]).catch(() => []);
  return dir && (!folder.within || dir.startsWith(within + sep)) ? dir : undefined;
}

// Docs in a folder of uncommitted docs (docs/local or notes), subfolders included: no git status, and
// the kind comes from the document.
async function flatDocs(repo: Repo, folder: Worktree) {
  const root = await flatRoot(folder);
  const entries = root ? await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []) : [];
  const docs: Doc[] = [];
  for (const entry of entries) {
    const path = posix.join(...relative(root!, join(entry.parentPath, entry.name)).split(sep));
    if (!entry.isFile() || /(^|\/)\./.test(path) || !/\.(md|html)$/.test(entry.name)) continue;
    const file = join(root!, path);
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]).catch(() => []);
    if (!content || !info) continue;
    const { title, kind, summary, text, decisions } = parseDocument(content, entry.name);
    const date = /\d{4}-\d{2}-\d{2}/.exec(entry.name)?.[0] ?? new Date(info.mtimeMs).toISOString().slice(0, 10);
    const place = repo.notes ? `notes/${path}` : `${repo.name} · ${localRoot}/${path}`;
    docs.push({ repo: repo.name, worktree: folder, path, place, title: title || entry.name, summary, text, date, kind: kind?.toLowerCase() || "note", mtime: info.mtimeMs, merged: true, local: true, decisions });
  }
  return docs;
}

async function scan(repos: Map<string, Repo>) {
  const docs: Doc[] = [];
  for (const repo of repos.values()) {
    docs.push(...(await flatDocs(repo, repo.local)));
    if (repo.notes) continue;
    const { commit, blobs: merged } = await defaultBranch(repo.dir);
    const algorithm = [...merged.values()][0]?.length === 64 ? "sha256" : "sha1";
    for (const worktree of repo.worktrees) {
      const inherited = await forkBlobs(worktree.dir, commit);
      for (const path of await docFiles(worktree.dir)) {
        const file = join(worktree.dir, path);
        const [content, info] = await Promise.all([readFile(file), lstat(file)]).catch(() => []);
        if (!content || !info?.isFile()) continue;
        const blob = createHash(algorithm).update(`blob ${content.length}\0`).update(content).digest("hex");
        const { title, kind, summary, text, decisions } = parseDocument(content.toString("utf8"), path);
        const date = /\d{4}-\d{2}-\d{2}/.exec(path)?.[0] ?? new Date(info.mtimeMs).toISOString().slice(0, 10);
        const doc = { repo: repo.name, worktree, path, place: `${repo.name} · ${worktree.key} · ${path}`, title: title || basename(path), summary, text, date, decisions };
        const isMerged = merged.get(path) === blob || inherited.get(path) === blob;
        docs.push({ ...doc, kind: kind?.toLowerCase() || folderKind(path), mtime: info.mtimeMs, merged: isMerged });
      }
    }
  }
  return docs;
}

// The last scan, refreshed behind the request so pages answer at once. A request that finds nothing,
// like a link to a document saved a moment ago, scans again before it says so.
let snapshot: Library | undefined;
let pending: Promise<Library> | undefined;
const rescan = () =>
  (pending ??= (async () => {
    const repos = await findRepos();
    snapshot = { at: Date.now(), repos, docs: await scan(repos) };
    return snapshot;
  })().finally(() => (pending = undefined)));
export async function library(fresh = false): Promise<Library> {
  const age = snapshot ? Date.now() - snapshot.at : Infinity;
  if (fresh || age > 30_000 || !snapshot) return rescan();
  if (age > 1000) rescan().catch(console.error);
  return snapshot;
}

// A merged document sits in every checkout, some copies behind the default branch; list it once,
// preferring the main checkout's copy.
export function unique(docs: Doc[]) {
  const merged = new Map<string, Doc>();
  for (const doc of docs.filter((doc) => doc.merged)) {
    const key = `${doc.repo}\0${doc.path}`;
    if (!merged.has(key) || doc.worktree.main) merged.set(key, doc);
  }
  return [...merged.values(), ...docs.filter((doc) => !doc.merged)];
}

// The worktree a "<branch>/<path>" tail names; branch names may contain slashes, so the longest match wins.
const worktreeIn = (repo: Repo, tail: string) =>
  repo.worktrees.toSorted((a, b) => b.key.length - a.key.length).find((candidate) => tail === candidate.key || tail.startsWith(`${candidate.key}/`));

// Pages are /<repo>/<branch>/<path> and raw files /raw/<repo>/<branch>/<path>; branch names may
// contain slashes. A link into a removed worktree matches no worktree but keeps its path. Local docs
// and notes are a path under /<repo>/~local or /~notes, subfolders included.
export function route(pathname: string, repos: Map<string, Repo>) {
  const [, name, ...rest] = pathname.split("/");
  const repo = repos.get(name);
  if (repo?.notes || rest[0] === "~local") {
    const file = (repo?.notes ? rest : rest.slice(1)).join("/");
    const valid = /\.(md|html)$/.test(file) && posix.normalize(file) === file && !/(^|\/)\./.test(file) && !/[\\\0]/.test(file);
    return { repo, worktree: repo?.local, path: valid ? file : undefined, extra: file !== "" };
  }
  const tail = rest.join("/");
  const worktree = repo && worktreeIn(repo, tail);
  const path = worktree ? tail.slice(worktree.key.length + 1) : docPathIn.exec(tail)?.[1];
  const valid = isDocPath(path ?? "") && posix.normalize(path!) === path && !path!.includes("\0");
  return { repo, worktree, path: valid ? path : undefined, extra: tail !== (worktree?.key ?? "") };
}

// Serves only regular files whose real path stays inside the worktree's docs folder, or inside a
// folder of local docs.
export async function resolveFile(worktree: Worktree, path: string) {
  if (worktree.local) {
    const root = await flatRoot(worktree);
    const file = root && (await realpath(join(root, path)).catch(() => undefined));
    if (!file?.startsWith(root + sep)) return undefined;
    return (await stat(file)).isFile() ? { file, directory: false } : undefined;
  }
  const root = await folderRoot(worktree.dir, rootOf(path));
  const file = root && (await realpath(join(worktree.dir, path)).catch(() => undefined));
  if (!file?.startsWith(root + sep)) return undefined;
  const info = await stat(file);
  return info.isFile() || info.isDirectory() ? { file, directory: info.isDirectory() } : undefined;
}

// A document's file on disk, from a Lectern URL such as /events?doc= or /raw/. Retries with a fresh scan.
export async function fileFor(pathname: string) {
  for (const fresh of [false, true]) {
    const { worktree, path } = route(pathname, (await library(fresh)).repos);
    const found = worktree && path && (await resolveFile(worktree, path.endsWith("/") ? `${path}index.html` : path));
    if (found) return found;
  }
  return undefined;
}

// Every file git tracks in a worktree, for source links. Untracked files (.env and the like) never show.
const tracked = new Map<string, { at: number; files: Promise<Set<string>> }>();
export function trackedFiles(dir: string) {
  const cached = tracked.get(dir);
  if (cached && Date.now() - cached.at < 30_000) return cached.files;
  const files = git(dir, "ls-files", "-z").then((output) => new Set(output.split("\0").filter(Boolean)), () => new Set<string>());
  tracked.set(dir, { at: Date.now(), files });
  return files;
}

// A tracked file from a /source/<repo>/<branch>/<path> URL: read-only, and only a regular file whose
// real path stays inside its worktree.
export async function sourceFile(pathname: string) {
  const [, name, ...rest] = pathname.split("/");
  const repo = (await library()).repos.get(name);
  const tail = rest.join("/");
  const worktree = repo && !repo.notes ? worktreeIn(repo, tail) : undefined;
  const path = worktree && tail.slice(worktree.key.length + 1);
  if (!worktree || !path || !(await trackedFiles(worktree.dir)).has(path)) return undefined;
  const [root, file] = await Promise.all([realpath(worktree.dir), realpath(join(worktree.dir, path))]).catch(() => []);
  if (!file?.startsWith(root + sep) || !(await stat(file)).isFile()) return undefined;
  return { repo: repo!, worktree, path, file };
}
