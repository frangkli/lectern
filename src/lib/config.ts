import { homedir } from "node:os";
import { join } from "node:path";
import { LECTERN_KIT, LECTERN_NOTES, LECTERN_ROOTS } from "astro:env/server";

// Defaults sit here rather than in the schema, so they follow the home folder of whoever runs the server.
export const roots = (LECTERN_ROOTS ?? join(homedir(), "workspace")).split(":").filter(Boolean);
export const notesDir = LECTERN_NOTES ?? join(homedir(), "workspace", "notes");
export const kitFile = LECTERN_KIT ?? join(homedir(), ".agents/skills/visual-doc/assets/template.html");
// Where Lectern keeps what it remembers between runs: the copy of each document you last read.
export const stateDir = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "lectern");
