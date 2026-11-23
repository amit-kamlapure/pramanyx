/** The tab's icon, as the coworker's tab draws it (`lib/markIcon.ts`). */
import { markIcon } from "@/lib/markIcon";

export const dynamic = "force-static";

export function GET() {
  return new Response(markIcon(), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
  });
}
