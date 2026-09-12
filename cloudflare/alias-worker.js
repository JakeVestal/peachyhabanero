/**
 * Serve jakevestal.com/* from the peachyhabanero GitHub Pages origin.
 * Paste into Cloudflare → Workers & Pages → Create Worker.
 *
 * Routes (jakevestal.com zone):
 *   jakevestal.com/*
 *   www.jakevestal.com/*
 *
 * Origin stays peachyhabanero.com (repo CNAME / GH Pages custom domain).
 * Path and query are preserved. Address bar stays jakevestal.com.
 */
const ORIGIN = "peachyhabanero.com";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const origin = new URL(incoming.toString());
    origin.hostname = ORIGIN;
    origin.protocol = "https:";

    const headers = new Headers(request.headers);
    headers.set("Host", ORIGIN);

    const resp = await fetch(origin.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    const out = new Headers(resp.headers);
    out.set("x-alias-origin", ORIGIN);
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: out,
    });
  },
};
