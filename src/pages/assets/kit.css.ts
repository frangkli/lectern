// The kit's CSS, for index pages; a document carries its own.
import { kit } from "../../lib/document";

export const GET = async () => new Response(await kit("style"), { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" } });
