type Handler = {
  match: (url: string) => boolean;
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
};
const registry = () =>
  (globalThis as unknown as { __fakeNetwork: Handler[] }).__fakeNetwork;

/** Answer outbound requests whose URL starts with `prefix`. Returns an undo function. */
export function fakeNetwork(
  prefix: string,
  respond: (
    url: string,
    body: unknown,
    init?: RequestInit,
  ) => { status?: number; json: unknown },
): () => void {
  const handler: Handler = {
    match: (url) => url.startsWith(prefix),
    respond: (url, init) => {
      let body: unknown = undefined;
      try {
        body =
          typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      } catch {
        body = init?.body;
      }
      const r = respond(url, body, init);
      return new Response(JSON.stringify(r.json), {
        status: r.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  registry().push(handler);
  return () => {
    const i = registry().indexOf(handler);
    if (i >= 0) registry().splice(i, 1);
  };
}
