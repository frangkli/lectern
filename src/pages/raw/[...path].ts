// A document on its own, without the hub's bar.
import type { APIRoute } from "astro";
import { documentHtml } from "../../lib/document";
import { fileFor } from "../../lib/library";

export const GET: APIRoute = async ({ url }) => {
  const found = await fileFor(decodeURIComponent(url.pathname).slice(4));
  if (!found) return new Response("Not found", { status: 404 });
  if (found.directory) return new Response(null, { status: 308, headers: { location: `${url.pathname}/` } });
  return new Response((await documentHtml(found.file)).html, { headers: { "content-type": "text/html; charset=utf-8" } });
};
