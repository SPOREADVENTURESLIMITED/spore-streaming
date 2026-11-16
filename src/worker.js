const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });

const encoder = new TextEncoder();
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function digest(value) {
  const result = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64url(new Uint8Array(result));
}
async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, key, 256);
  return "pbkdf2$310000$" + base64url(salt) + "$" + base64url(new Uint8Array(bits));
}
async function verifyPassword(password, stored) {
  const [scheme, rounds, saltText, expected] = (stored || "").split("$");
  if (scheme !== "pbkdf2" || rounds !== "310000" || !saltText || !expected) return false;
  const actual = await hashPassword(password, fromBase64url(saltText));
  return actual === stored;
}
function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const part = cookies.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}
function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return "spore_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
async function currentUser(request, env) {
  const token = cookieValue(request, "spore_session");
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.display_name, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND julianday(s.expires_at) > julianday('now') AND u.status='active'"
  ).bind(tokenHash).first();
  return row || null;
}
async function createSession(userId, env) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)")
    .bind(crypto.randomUUID(), userId, tokenHash, expires).run();
  return token;
}
async function handleAuth(request, env, path) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  if (request.method === "GET" && path === "/api/auth/me") {
    const user = await currentUser(request, env);
    return json({ user: user ? { id:user.id, email:user.email, display_name:user.display_name, role:user.role } : null });
  }
  if (request.method === "POST" && path === "/api/auth/logout") {
    const token = cookieValue(request, "spore_session");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }
  if (request.method !== "POST" || !["/api/auth/register", "/api/auth/login"].includes(path)) {
    return json({ error: "Not found" }, 404);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length > 128) {
    return json({ error: "Enter a valid email and password." }, 400);
  }
  let user;
  if (path.endsWith("/register")) {
    const displayName = String(body.display_name || "").trim();
    if (displayName.length < 2 || displayName.length > 80 || password.length < 12) {
      return json({ error: "Use a display name of 2–80 characters and a password of at least 12 characters." }, 400);
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (existing) return json({ error: "Unable to create account with those details." }, 409);
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      await env.DB.prepare("INSERT INTO users (id,email,display_name,password_hash) VALUES (?,?,?,?)")
        .bind(id, email, displayName, passwordHash).run();
    } catch {
      return json({ error: "Unable to create account. Please try again." }, 409);
    }
    user = { id, email, display_name: displayName, role: "user" };
  } else {
    const row = await env.DB.prepare("SELECT id,email,display_name,role,password_hash,status FROM users WHERE email=?").bind(email).first();
    if (!row || row.status !== "active" || !(await verifyPassword(password, row.password_hash))) {
      return json({ error: "Email or password is incorrect." }, 401);
    }
    user = { id: row.id, email: row.email, display_name: row.display_name, role: row.role };
  }
  const token = await createSession(user.id, env);
  return json({ user }, 200, { "set-cookie": sessionCookie(token) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/")) {
      try { return await handleAuth(request, env, url.pathname); }
      catch { return json({ error: "Authentication service is temporarily unavailable." }, 500); }
    }
    if (url.pathname.startsWith("/api/account/")) {
      if (!env.DB) return json({ error: "Database is not configured." }, 503);
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Sign in required." }, 401);
      try {
        if (request.method === "GET" && url.pathname === "/api/account/dashboard") {
          const [subscription, watchlist, history] = await Promise.all([
            env.DB.prepare("SELECT plan_code,status,starts_at,ends_at FROM subscriptions WHERE user_id=? AND status='active' AND (ends_at IS NULL OR julianday(ends_at)>julianday('now')) ORDER BY created_at DESC LIMIT 1").bind(user.id).first(),
            env.DB.prepare("SELECT t.id,t.title,t.media_type,t.access_tier,w.created_at FROM watchlist w JOIN titles t ON t.id=w.title_id WHERE w.user_id=? ORDER BY w.created_at DESC LIMIT 50").bind(user.id).all(),
            env.DB.prepare("SELECT t.id,t.title,t.media_type,h.progress_seconds,h.updated_at FROM watch_history h JOIN titles t ON t.id=h.title_id WHERE h.user_id=? ORDER BY h.updated_at DESC LIMIT 20").bind(user.id).all()
          ]);
          return json({ user, subscription: subscription || null, watchlist: watchlist.results || [], history: history.results || [] });
        }
        if (request.method === "POST" && url.pathname === "/api/account/watchlist") {
          const body = await request.json();
          const titleId = String(body.title_id || "");
          if (!titleId || titleId.length > 80) return json({ error: "A valid title_id is required." }, 400);
          const title = await env.DB.prepare("SELECT id FROM titles WHERE id=? AND status='published'").bind(titleId).first();
          if (!title) return json({ error: "Title not found." }, 404);
          await env.DB.prepare("INSERT OR IGNORE INTO watchlist (user_id,title_id) VALUES (?,?)").bind(user.id,titleId).run();
          return json({ ok: true });
        }
        if (request.method === "DELETE" && url.pathname === "/api/account/watchlist") {
          const titleId = url.searchParams.get("title_id") || "";
          if (!titleId) return json({ error: "title_id is required." }, 400);
          await env.DB.prepare("DELETE FROM watchlist WHERE user_id=? AND title_id=?").bind(user.id,titleId).run();
          return json({ ok: true });
        }
        if (request.method === "POST" && url.pathname === "/api/account/history") {
          const body = await request.json();
          const titleId = String(body.title_id || "");
          const progress = Number(body.progress_seconds);
          if (!titleId || !Number.isInteger(progress) || progress < 0 || progress > 86400) return json({ error: "Invalid viewing progress." }, 400);
          const title = await env.DB.prepare("SELECT id FROM titles WHERE id=? AND status='published'").bind(titleId).first();
          if (!title) return json({ error: "Title not found." }, 404);
          await env.DB.prepare("INSERT INTO watch_history (user_id,title_id,progress_seconds,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,title_id) DO UPDATE SET progress_seconds=excluded.progress_seconds,updated_at=CURRENT_TIMESTAMP").bind(user.id,titleId,progress).run();
          return json({ ok: true });
        }
      } catch {
        return json({ error: "Account service is temporarily unavailable." }, 500);
      }
      return json({ error: "Not found." }, 404);
    }
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
      try {
        const result = await env.DB.prepare(query).bind(...values).all();
        return json({ items: result.results || [] });
      } catch {
        return json({ error: "Catalogue is temporarily unavailable." }, 500);
      }
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("SPORE MAX API is running. Configure the public assets directory.");
  }
};
