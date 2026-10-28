// Tells an open document that its file changed on disk, so the page reloads.
import { stat } from "node:fs/promises";
import type { APIRoute } from "astro";
import { fileFor } from "../lib/library";

export const GET: APIRoute = async ({ url, request }) => {
  const found = await fileFor(decodeURIComponent(url.searchParams.get("doc") ?? ""));
  if (!found) return new Response("Not found", { status: 404 });
  const mtime = () => stat(found.file).then((info) => info.mtimeMs, () => 0);
  let last = await mtime();
  let timer: ReturnType<typeof setInterval>;
  let closed = false;
  const close = () => ((closed = true), clearInterval(timer));
  const body = new ReadableStream({
    start(controller) {
      timer = setInterval(async () => {
        const now = await mtime();
        // A tick already waiting on stat() when the reader leaves must not write to the closed stream.
        if (now !== last && !closed) controller.enqueue("data: change\n\n");
        last = now;
      }, 1000);
      request.signal.addEventListener("abort", close);
    },
    cancel: close,
  });
  return new Response(body.pipeThrough(new TextEncoderStream()), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
};
