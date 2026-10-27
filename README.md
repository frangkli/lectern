# lectern

A reading room for the docs agents write. Lectern serves every git checkout's `docs/` and `internal/docs/` folders, worktrees and unmerged branches included, read live from disk, so a plan shows up the moment an agent saves it. A doc that differs from the default branch is marked as a draft.

It also lists two kinds of uncommitted docs: each main checkout's `docs/local/` folder, and a notes folder for docs that belong to no repository.

## Run it

Lectern needs Node 24 and pnpm.

```sh
pnpm install
pnpm build
HOST=127.0.0.1 PORT=7777 pnpm start
```

It binds to loopback. It has no login, so put it behind something that controls access, such as `tailscale serve`, if you want to read from another device.

For development, `pnpm dev` serves with live reload.

## Settings

| Variable | Default | What it is |
|---|---|---|
| `LECTERN_ROOTS` | `~/workspace` | Folders holding your clones, separated by `:`. Lectern finds each clone's worktrees wherever they live. |
| `LECTERN_NOTES` | `~/workspace/notes` | The notes folder. |
| `LECTERN_KIT` | `~/.agents/skills/visual-doc/assets/template.html` | The HTML template whose `<style id="kit">` and `<script id="kit-js">` style every page. |

## URLs

- `/<repo>/<branch>/<path>`: a committed doc on a branch.
- `/<repo>/~local/<path>`: a doc in that repository's `docs/local/`.
- `/~notes/<path>`: a note.
- `/raw/…`: the same doc without the hub around it.

Git doesn't allow `~` in branch names, so these never collide with a branch.
