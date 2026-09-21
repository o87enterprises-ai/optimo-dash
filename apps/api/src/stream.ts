import type { Request, Response } from "express";
import { redis, UPDATES_CHANNEL } from "./db";

/**
 * Server-Sent Events feed. Clients open one connection and receive
 * incremental updates instead of polling every endpoint on a timer.
 *
 * Each SSE client gets its own Redis subscriber connection, because a
 * subscribed ioredis client cannot run ordinary commands. Clients may filter
 * to a single site with ?site=<id>.
 */

const HEARTBEAT_MS = 15000;

export function streamHandler(req: Request, res: Response) {
  const siteFilter = req.query.site ? Number(req.query.site) : null;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Without this, nginx and similar proxies buffer the stream into silence.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ kind: "heartbeat", at: new Date().toISOString(), payload: { connected: true } });

  const sub = redis.duplicate();
  sub.on("error", (e) => console.error("[stream]", e.message));
  sub.subscribe(UPDATES_CHANNEL).catch((e) => console.error("[stream] subscribe", e.message));

  sub.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message);
      if (siteFilter !== null && event.siteId !== undefined && event.siteId !== siteFilter) return;
      send(event);
    } catch {
      // A malformed publish must not kill the connection.
    }
  });

  // Keeps intermediaries from timing out an idle connection.
  const beat = setInterval(
    () => send({ kind: "heartbeat", at: new Date().toISOString() }),
    HEARTBEAT_MS
  );

  const cleanup = () => {
    clearInterval(beat);
    sub.disconnect();
  };
  req.on("close", cleanup);
  res.on("error", cleanup);
}
