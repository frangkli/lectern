// The kit's script, for index pages: the theme control.
import { kit } from "../../lib/document";

export const GET = () => new Response(kit.script, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
