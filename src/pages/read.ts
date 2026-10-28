// The browser reports a document as read once it is shown, so a page prerendered on hover doesn't count.
import type { APIRoute } from "astro";
import { fileFor } from "../lib/library";
import { markRead } from "../lib/reads";

export const POST: APIRoute = async ({ url }) => {
  const found = await fileFor(decodeURIComponent(url.searchParams.get("doc") ?? ""));
  if (!found || found.directory) return new Response("Not found", { status: 404 });
  await markRead(found.file);
  return new Response(null, { status: 204 });
};
