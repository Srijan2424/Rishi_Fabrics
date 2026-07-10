import { randomUUID } from "node:crypto";

type SentryDsn = {
  endpoint: string;
  publicKey: string;
};

function parseSentryDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace("/", "");
    if (!url.username || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      publicKey: url.username
    };
  } catch {
    return null;
  }
}

export async function captureError(input: {
  error: unknown;
  route?: string;
  method?: string;
  userId?: string;
}) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const sentry = parseSentryDsn(dsn);
  if (!sentry) {
    console.info("[sentry] SENTRY_DSN is configured but invalid.");
    return;
  }

  const error = input.error instanceof Error ? input.error : new Error(String(input.error));
  const eventId = randomUUID().replace(/-/g, "");
  const payload = {
    event_id: eventId,
    platform: "javascript",
    logger: "rishi-fabrics-api",
    level: "error",
    timestamp: new Date().toISOString(),
    message: error.message,
    exception: {
      values: [{
        type: error.name,
        value: error.message,
        stacktrace: error.stack ? { frames: [{ filename: input.route, function: input.method, context_line: error.stack }] } : undefined
      }]
    },
    request: {
      url: input.route,
      method: input.method
    },
    user: input.userId ? { id: input.userId } : undefined,
    tags: {
      service: "rishi-fabrics-api"
    }
  };

  const url = `${sentry.endpoint}?sentry_key=${encodeURIComponent(sentry.publicKey)}&sentry_version=7`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.info(`[sentry] Failed to capture API error: ${response.status}`);
  }
}
