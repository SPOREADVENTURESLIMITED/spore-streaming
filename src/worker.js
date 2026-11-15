const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, app: env.APP_NAME || "SPORE MAX", service: "api" });
    }
    if (request.method === "GET" && url.pathname === "/api/catalogue") {
      if (!env.DB) return json({ error: "Database is not configured." }, 503);
      const type = url.searchParams.get("type");
      const allowed = new Set(["movie", "series", "live", "music"]);
      if (type && !allowed.has(type)) return json({ error: "Invalid content type." }, 400);
      let query = "SELECT id, title, description, media_type, access_tier, poster_key FROM titles WHERE status = 'published'";
      const values = [];
      if (type) { query += " AND media_type = ?"; values.push(type); }
      query += " ORDER BY published_at DESC LIMIT 100";
      const result = await env.DB.prepare(query).bind(...values).all();
      return json({ items: result.results || [] });
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("SPORE MAX API is running. Configure the public assets directory.", { status: 200 });
  }
};
