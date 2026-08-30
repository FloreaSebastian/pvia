import { captureError } from "./monitoring.server";

type ClientCrashInput = {
  route: string;
  message: string;
  stack?: string;
};

function sanitize(value: string, maxLength: number): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/([?&](?:token|code|key|session|access_token|refresh_token)=)[^\s&#)]+/gi, "$1[redacted]")
    .slice(0, maxLength);
}

export async function recordClientCrash(input: ClientCrashInput, userId: string): Promise<void> {
  const route = input.route.startsWith("/") ? input.route.split(/[?#]/, 1)[0] || "/" : "unknown";
  const message = sanitize(input.message || "Client runtime error", 1_000);
  const error = new Error(message);
  if (input.stack) error.stack = sanitize(input.stack, 8_000);

  await captureError({
    source: `client:react-boundary:${route}`,
    error,
    severity: "critical",
    context: { route },
    userId,
  });
}