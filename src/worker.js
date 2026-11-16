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
  if (request.method === "POST" && path === "/api/auth/forgot-password") {
    let body; try { body=await request.json(); } catch { return json({error:"Invalid request."},400); }
    const email=String(body.email||"").trim().toLowerCase();
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length>254) return json({error:"If the account exists, reset instructions will be sent."});
    const user=await env.DB.prepare("SELECT id,email FROM users WHERE email=? AND status='active'").bind(email).first();
    if(user && env.RESEND_API_KEY && env.RESET_EMAIL_FROM && env.APP_ORIGIN) {
      const token=base64url(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash=await digest(token);
      const expires=new Date(Date.now()+30*60*1000).toISOString();
      await env.DB.prepare("INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),user.id,tokenHash,expires).run();
      const resetUrl=env.APP_ORIGIN.replace(/\\/$/,"")+"/?reset_token="+encodeURIComponent(token);
      await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.RESET_EMAIL_FROM,to:[user.email],subject:"Reset your SPORE MAX password",html:"<p>We received a password reset request for your SPORE MAX account.</p><p><a href='"+resetUrl+"'>Reset password</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>"})});
    }
    return json({message:"If an active account matches that address, reset instructions will be sent."});
  }
  if (request.method === "POST" && path === "/api/auth/reset-password") {
    let body; try { body=await request.json(); } catch { return json({error:"Invalid request."},400); }
    const token=String(body.token||""), password=String(body.password||"");
    if(token.length<32 || password.length<12 || password.length>128) return json({error:"Use a valid reset link and a password of at least 12 characters."},400);
    const tokenHash=await digest(token);
    const reset=await env.DB.prepare("SELECT id,user_id FROM password_resets WHERE token_hash=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").bind(tokenHash).first();
    if(!reset) return json({error:"This password reset link is invalid or expired."},400);
    const passwordHash=await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash,reset.user_id),
      env.DB.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(reset.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(reset.user_id)
    ]);
    return json({ok:true,message:"Password updated. Please sign in again."});
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
    if (user.role === "admin" && await mfaEnabled(user.id,env)) {
      let verified = await verifyTotp(await decryptMfaSecret(
        (await env.DB.prepare("SELECT secret_ciphertext FROM admin_mfa WHERE user_id=? AND enabled=1").bind(user.id).first()).secret_ciphertext,env
      ),body.totp_code);
      if (!verified && body.recovery_code) verified = await verifyRecoveryCode(user.id,body.recovery_code,env);
      if (!verified) return json({ error: "Administrator verification code required or invalid.", mfa_required: true }, 401);
    }
  }
  const token = await createSession(user.id, env);
  return json({ user }, 200, { "set-cookie": sessionCookie(token) });
}



function base32Encode(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const ch of text.replace(/=+$/,"").toUpperCase()) {
    const n = alphabet.indexOf(ch); if (n < 0) throw new Error("Invalid base32");
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
async function mfaAesKey(env) {
  if (!env.MFA_ENCRYPTION_KEY || env.MFA_ENCRYPTION_KEY.length < 32) throw new Error("MFA_ENCRYPTION_KEY must be configured with at least 32 characters.");
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(env.MFA_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptMfaSecret(secret, env) {
  const iv=crypto.getRandomValues(new Uint8Array(12)), key=await mfaAesKey(env);
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(secret));
  return base64url(iv)+"."+base64url(new Uint8Array(encrypted));
}
async function decryptMfaSecret(value, env) {
  const [ivText,dataText]=value.split(".");
  const key=await mfaAesKey(env);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64url(ivText)},key,fromBase64url(dataText));
  return new TextDecoder().decode(plain);
}
async function totp(secret, time=Date.now()) {
  const counter=Math.floor(time/30000), msg=new Uint8Array(8);
  let n=counter;
  for(let i=7;i>=0;i--){msg[i]=n&255;n=Math.floor(n/256);}
  const key=await crypto.subtle.importKey("raw",base32Decode(secret),{name:"HMAC",hash:"SHA-1"},false,["sign"]);
  const mac=new Uint8Array(await crypto.subtle.sign("HMAC",key,msg));
  const offset=mac[mac.length-1]&15;
  const binary=((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3];
  return String(binary%1000000).padStart(6,"0");
}
async function verifyTotp(secret, code) {
  if(!/^\d{6}$/.test(String(code||""))) return false;
  for(const drift of [-30000,0,30000]) if(await totp(secret,Date.now()+drift)===String(code)) return true;
  return false;
}
async function mfaEnabled(userId,env) {
  const row=await env.DB.prepare("SELECT enabled FROM admin_mfa WHERE user_id=?").bind(userId).first();
  return !!(row && row.enabled===1);
}
async function verifyRecoveryCode(userId,code,env) {
  const normalized=String(code||"").replace(/[^A-Za-z0-9]/g,"").toUpperCase();
  if(normalized.length!==16) return false;
  const hash=await digest(normalized);
  const row=await env.DB.prepare("SELECT id FROM admin_mfa_recovery WHERE user_id=? AND code_hash=? AND used_at IS NULL").bind(userId,hash).first();
  if(!row) return false;
  await env.DB.prepare("UPDATE admin_mfa_recovery SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
  return true;
}
async function adminMfaRoute(request,env,url,user) {
  if(request.method==="GET" && url.pathname==="/api/admin/mfa/status")
    return json({enabled:await mfaEnabled(user.id,env)});
  if(request.method==="POST" && url.pathname==="/api/admin/mfa/setup") {
    if(await mfaEnabled(user.id,env)) return json({error:"MFA is already enabled."},409);
    const secret=base32Encode(crypto.getRandomValues(new Uint8Array(20)));
    const encrypted=await encryptMfaSecret(secret,env);
    await env.DB.prepare("INSERT INTO admin_mfa(user_id,secret_ciphertext,enabled) VALUES(?,?,0) ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,enabled=0,created_at=CURRENT_TIMESTAMP").bind(user.id,encrypted).run();
    const issuer="SPORE%20MAX";
    const label=encodeURIComponent(user.email);
    return json({secret,otpauth_uri:"otpauth://totp/"+issuer+":"+label+"?secret="+secret+"&issuer="+issuer+"&algorithm=SHA1&digits=6&period=30"});
  }
  if(request.method==="POST" && url.pathname==="/api/admin/mfa/enable") {
    const body=await request.json();
    const row=await env.DB.prepare("SELECT secret_ciphertext FROM admin_mfa WHERE user_id=? AND enabled=0").bind(user.id).first();
    if(!row) return json({error:"Start MFA setup first."},400);
    const secret=await decryptMfaSecret(row.secret_ciphertext,env);
    if(!(await verifyTotp(secret,body.code))) return json({error:"The verification code is invalid."},400);
    const codes=Array.from({length:8},()=>base32Encode(crypto.getRandomValues(new Uint8Array(10))).slice(0,16));
    const statements=[env.DB.prepare("UPDATE admin_mfa SET enabled=1,enabled_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(user.id)];
    for(const code of codes) statements.push(env.DB.prepare("INSERT INTO admin_mfa_recovery(id,user_id,code_hash) VALUES(?,?,?)").bind(crypto.randomUUID(),user.id,await digest(code)));
    await env.DB.batch(statements);
    return json({enabled:true,recovery_codes:codes});
  }
  return json({error:"Not found."},404);
}

async function adminRoute(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  const admin = await currentUser(request, env);
  if (!admin) return json({ error: "Sign in required." }, 401);
  if (admin.role !== "admin") return json({ error: "Administrator access required." }, 403);
  if (url.pathname.startsWith("/api/admin/mfa/")) return adminMfaRoute(request,env,url,admin);
  if (!(await mfaEnabled(admin.id,env))) return json({ error: "Administrator MFA setup is required." }, 403);
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) {
    return json({ error: "Invalid request origin." }, 403);
  }
  const audit = async (action, type, id, details = null) => {
    await env.DB.prepare("INSERT INTO admin_audit_logs (id,admin_user_id,action,target_type,target_id,details) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), admin.id, action, type, id, details ? JSON.stringify(details) : null).run();
  };
  try {
    if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
      const [users, titles, published, drafts, recent] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS count FROM users").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM titles").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM titles WHERE status='published'").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM titles WHERE status='draft'").first(),
        env.DB.prepare("SELECT id,title,media_type,access_tier,status,created_at FROM titles ORDER BY created_at DESC LIMIT 100").all()
      ]);
      return json({ admin: { id: admin.id, email: admin.email, display_name: admin.display_name }, stats: { users: users.count, titles: titles.count, published: published.count, drafts: drafts.count }, titles: recent.results || [] });
    }
    if (request.method === "POST" && url.pathname === "/api/admin/titles") {
      const body = await request.json();
      const title = String(body.title || "").trim();
      const description = String(body.description || "").trim();
      const mediaType = String(body.media_type || "");
      const tier = String(body.access_tier || "free");
      if (title.length < 1 || title.length > 180 || description.length > 5000 ||
          !["movie","series","live","music"].includes(mediaType) || !["free","premium"].includes(tier)) {
        return json({ error: "Check the title, description, content type and access tier." }, 400);
      }
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO titles (id,title,description,media_type,access_tier,status) VALUES (?,?,?,?,?,'draft')")
        .bind(id,title,description,mediaType,tier).run();
      await audit("title.created","title",id,{title,media_type:mediaType,access_tier:tier});
      return json({ ok: true, id }, 201);
    }
    const titleMatch = url.pathname.match(/^\/api\/admin\/titles\/([a-f0-9-]+)$/i);
    if (titleMatch && request.method === "PATCH") {
      const id = titleMatch[1];
      const body = await request.json();
      const current = await env.DB.prepare("SELECT id FROM titles WHERE id=?").bind(id).first();
      if (!current) return json({ error: "Title not found." }, 404);
      const fields = [];
      const values = [];
      if (body.title !== undefined) {
        const value = String(body.title).trim();
        if (!value || value.length > 180) return json({ error: "Invalid title." }, 400);
        fields.push("title=?"); values.push(value);
      }
      if (body.description !== undefined) {
        const value = String(body.description).trim();
        if (value.length > 5000) return json({ error: "Description is too long." }, 400);
        fields.push("description=?"); values.push(value);
      }
      if (body.access_tier !== undefined) {
        if (!["free","premium"].includes(body.access_tier)) return json({ error: "Invalid access tier." }, 400);
        fields.push("access_tier=?"); values.push(body.access_tier);
      }
      if (body.status !== undefined) {
        if (!["draft","published","archived"].includes(body.status)) return json({ error: "Invalid publication status." }, 400);
        fields.push("status=?"); values.push(body.status);
        fields.push("published_at=?"); values.push(body.status === "published" ? new Date().toISOString() : null);
      }
      if (!fields.length) return json({ error: "No supported changes supplied." }, 400);
      fields.push("updated_at=CURRENT_TIMESTAMP");
      values.push(id);
      await env.DB.prepare("UPDATE titles SET " + fields.join(",") + " WHERE id=?").bind(...values).run();
      await audit("title.updated","title",id,body);
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      const result = await env.DB.prepare("SELECT id,email,display_name,role,status,created_at FROM users ORDER BY created_at DESC LIMIT 200").all();
      return json({ users: result.results || [] });
    }
    if (request.method === "PATCH" && /^\/api\/admin\/users\/[a-f0-9-]+\/status$/i.test(url.pathname)) {
      const id = url.pathname.split("/")[4];
      if (id === admin.id) return json({ error: "You cannot change your own account status here." }, 400);
      const body = await request.json();
      if (!["active","suspended","pending"].includes(body.status)) return json({ error: "Invalid account status." }, 400);
      const target = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
      if (!target) return json({ error: "User not found." }, 404);
      await env.DB.prepare("UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.status,id).run();
      if (body.status !== "active") await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
      await audit("user.status_changed","user",id,{status:body.status});
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  } catch {
    return json({ error: "Administrator service is temporarily unavailable." }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/")) {
      try { return await handleAuth(request, env, url.pathname); }
      catch { return json({ error: "Authentication service is temporarily unavailable." }, 500); }
    }
    if (url.pathname.startsWith("/api/admin/")) return adminRoute(request, env, url);
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
