import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Redis } from "ioredis";

/**
 * Server-Sent Events feed, self-hosted build only.
 *
 * Each client gets its own Redis subscriber connection, because a subscribed
 * ioredis client cannot run ordinary commands. Clients may filter to one site
 * with ?site=<id>.
 *
 * The Cloudflare build has no equivalent: Workers isolates share no pub/sub,
 * so that deployment polls instead.
 */

const HEARTBEAT_MS = 15000;
const UPDATES_CHANNEL = "dash:updates";

export function streamHandler(c: Context, redis: Redis) {
  const siteFilter = c.req.query("site") ? Number(c.req.query("site")) : null;

  // Stops proxies such as nginx from buffering the stream into silence.
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");

  return streamSSE(c, async (stream) => {
    const sub = redis.duplicate();
    sub.on("error", (e) => console.error("[stream]", e.message));

    let open = true;
    stream.onAbort(() => {
      open = false;
      sub.disconnect();
    });

    await stream.writeSSE({
      data: JSON.stringify({ kind: "heartbeat", at: new Date().toISOString(), payload: { connected: true } }),
    });

    await sub.subscribe(UPDATES_CHANNEL).catch((e) => console.error("[stream] subscribe", e.message));

    sub.on("message", (_channel, message) => {
      try {
        const event = JSON.parse(message);
        if (siteFilter !== null && event.siteId !== undefined && event.siteId !== siteFilter) return;
        void stream.writeSSE({ data: JSON.stringify(event) });
      } catch {
        // A malformed publish must not kill the connection.
      }
    });

    // Keeps intermediaries from timing out an idle connection, and doubles as
    // the loop that holds the response open.
    while (open) {
      await stream.sleep(HEARTBEAT_MS);
      if (!open) break;
      await stream.writeSSE({ data: JSON.stringify({ kind: "heartbeat", at: new Date().toISOString() }) });
    }
  });
}
