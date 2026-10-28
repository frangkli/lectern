// Mark as read: the page sends the version it shows, and gets a conflict once the file has changed since.
import type { APIRoute } from "astro";
import { fileFor } from "../lib/library";
import { markRead } from "../lib/reads";

export const POST: APIRoute = async ({ url }) => {
  const found = await fileFor(decodeURIComponent(url.searchParams.get("doc") ?? ""));
  if (!found || found.directory) return new Response("Not found", { status: 404 });
  const version = Number(url.searchParams.get("version") || Number.NaN);
  if (!Number.isInteger(version)) return new Response("Bad version", { status: 400 });
  return new Response(null, { status: (await markRead(found.file, version)) ? 204 : 409 });
};
