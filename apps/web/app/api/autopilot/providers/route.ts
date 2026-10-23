import { statuses } from "../../../../lib/autopilot/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return Response.json(await statuses(req));
}
