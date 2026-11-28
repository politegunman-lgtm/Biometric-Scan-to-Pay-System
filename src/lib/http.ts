export const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });

export const fail = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error: message, ...extra }, { status, headers: { "cache-control": "no-store" } });

export async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function handleRoute<T>(label: string, fn: () => Promise<T> | T): Promise<Response> {
  return Promise.resolve()
    .then(fn)
    .then((data) => json(data))
    .catch((err: unknown) => {
      console.error(`[api:${label}]`, err);
      const message = err instanceof Error ? err.message : "Unexpected error";
      return fail(message, 500);
    });
}
