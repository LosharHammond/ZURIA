// instrumentation.ts
// Next.js instrumentation hook — loads Sentry for server/edge runtimes.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  const { captureException, withScope } = await import("@sentry/nextjs");
  withScope((scope) => {
    scope.setContext("request", { path: request.path, method: request.method });
    scope.setContext("route", context);
    captureException(error);
  });
}
