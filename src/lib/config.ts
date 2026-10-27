import { homedir } from "node:os";
import { join } from "node:path";

// Where to look, from the environment: LECTERN_ROOTS (colon-separated folders of clones),
// LECTERN_NOTES (the notes folder) and LECTERN_KIT (the visual-doc template the hub styles itself with).
const env = process.env;
export const roots = (env.LECTERN_ROOTS ?? join(homedir(), "workspace")).split(":").filter(Boolean);
export const notesDir = env.LECTERN_NOTES ?? join(homedir(), "workspace", "notes");
export const kitFile = env.LECTERN_KIT ?? join(homedir(), ".agents/skills/visual-doc/assets/template.html");
