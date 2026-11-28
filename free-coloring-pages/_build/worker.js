// Cloudflare Worker "makeacoloringbook".
// 1. Serves the site from popcornlove.net/free-coloring-pages at makeacoloringbook.com.
// 2. Forwards every other attached host to makeacoloringbook.com.
// 3. /api/make: draws a coloring page on the spot from a typed idea (OpenAI image API).
// 4. /api/hearts, /api/heart: public heart counts for each page (KV "heart:<id>", count kept in key metadata).
// 5. /api/team/*: Uncle Dave's team tools (key checked against TEAM_KEY_HASH): draw without the visitor limits, publish to the site.
//    A GitHub Action (team-pages) pulls /api/team/queue every few minutes and adds published pages to the site.
// 6. /api/order/*, /api/print/*, /api/mail/*, /api/admin/*: paid printed books (see PAID BOOKS below) and a cron.
// Needs: secret OPENAI_API_KEY, KV binding KV. Optional secret TURNSTILE_SECRET turns on the human check
// (Cloudflare Turnstile widget "makeacoloringbook draw"; its public site key is TS_SITEKEY below). Optional vars: LIMIT_IP (default 3 a day per visitor),
// LIMIT_DAY (default 150 a day for the whole site), QUALITY (low|medium|high, default medium), IMAGE_MODEL.
const HOME = "makeacoloringbook.com";
const SRC = "https://popcornlove.net/free-coloring-pages";
const TS_SITEKEY = "0x4AAAAAAGVHFHAOuaC0U7Kc";
const STYLES = {
  easy: "Style: bold and easy coloring page for toddlers and preschoolers, very thick uniform black outlines, large simple shapes, big open areas to color, cute friendly cartoon look with simple smiling faces, minimal background detail.",
  whimsical: "Style: whimsical storybook coloring page for kids ages 6 to 10, medium-weight clean outlines, charming hand-drawn cartoon characters, playful full scene with a fun background, moderate detail.",
  realistic: "Style: realistic, naturalistic coloring page for teens and adults, accurate anatomy and proportions drawn like a detailed pen-and-ink illustration, fine confident contour lines, texture detail shown with outline only, rich scenic background.",
  intricate: "Style: intricate adult coloring book page, fine detailed linework, every element filled with ornate decorative patterns (zentangle, mandala, floral and paisley motifs), dense detailed composition with many small enclosed areas to color.",
};
const TAIL = "Pure black line art on a pure white background, clean crisp closed outlines, no shading, no hatching, no gray tones, no color, no solid black filled areas, no text, no letters, no numbers, no signature, no watermark, no border or frame. The whole illustration fits inside the page with a clear white margin on all four sides.";
const WHOLE = "Draw every character completely and correctly: each face has two eyes, and hands, paws and feet are finished with the right number of parts. Nothing is left half drawn or hidden by mistake.";
const RULES = "This is for a family website used by children. Keep it friendly and suitable for all ages. If the idea names a character from a movie, show, book, comic, toy or game, a brand or logo, or a real person, do not draw them: draw an original, generic version of the same kind of thing instead. Never include nudity, gore, weapons pointed at anyone, drugs, alcohol, hateful symbols or anything frightening for a small child.";
// Words we refuse outright. Kept short on purpose; the image model and the moderation check catch the rest.
const BLOCK = /\b(nude|naked|nsfw|sexy|sex|porn\w*|boobs?|penis|vagina|genital\w*|erotic\w*|fetish\w*|lingerie|murder\w*|bloody|gore|gory|behead\w*|suicid\w*|self[- ]?harm|rape\w*|nazi\w*|swastika|hitler|kkk|terroris\w*|cocaine|heroin|meth|marijuana|vap(e|es|ing)|cigarettes?|vodka|whiskey|drunk|guns?|rifles?|pistols?|grenades?)\b/i;
const NAMES = /\b(mickey|minnie|disney|pixar|elsa|moana|marvel|spider[- ]?man|iron ?man|hulk|batman|superman|pokemon|pok[eé]mon|pikachu|mario|luigi|zelda|sonic|minecraft|roblox|fortnite|bluey|peppa|paw patrol|cocomelon|barbie|hello kitty|sanrio|star wars|yoda|grogu|harry potter|hogwarts|simpsons|spongebob|minions?|shrek|lego|nike|taylor swift|trump|biden|obama|kardashian|messi|ronaldo)\b/i;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const today = () => new Date().toISOString().slice(0, 10);
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

async function counts(env, ip) {
  const day = today();
  const ipKey = "ip:" + day + ":" + (await sha(ip + "|" + day));
  const dayKey = "day:" + day;
  const [a, b] = await Promise.all([env.KV.get(ipKey), env.KV.get(dayKey)]);
  return { ipKey, dayKey, mine: num(a, 0), all: num(b, 0), limIp: num(env.LIMIT_IP, 3), limDay: num(env.LIMIT_DAY, 150) };
}


const promptFor = (idea, style) => "Black and white coloring book page, portrait orientation. Subject: " + idea + ". " + STYLES[style] + " " + WHOLE + " " + TAIL + " " + RULES;
const cleanIdea = (t, n) => String(t || "").replace(/[\u0000-\u001f<>{}\[\]\\`]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 200);
async function moderate(env, text) {
  try {
    const m = await fetch("https://api.openai.com/v1/moderations", { method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ model: "omni-moderation-latest", input: text }) });
    if (!m.ok) return m.status === 401 || m.status === 429 ? "upstream" : "flagged";
    const j = await m.json();
    return j.results && j.results[0] && j.results[0].flagged ? "flagged" : "";
  } catch (e) { return "flagged"; }
}

async function status(q, env) {
  if (!env.OPENAI_API_KEY || !env.KV) return json({ ok: false });
  const c = await counts(env, q.headers.get("cf-connecting-ip") || "0");
  return json({ ok: c.all < c.limDay, left: Math.max(0, c.limIp - c.mine), perDay: c.limIp, ts: env.TURNSTILE_SECRET ? TS_SITEKEY : "" });
}

async function make(q, env) {
  if (!env.OPENAI_API_KEY || !env.KV) return json({ error: "off", message: "Instant pages are not switched on yet." }, 503);
  const origin = q.headers.get("origin") || "";
  if (origin && origin !== "https://" + HOME) return json({ error: "origin" }, 403);
  let body;
  try { body = await q.json(); } catch (e) { return json({ error: "bad", message: "That did not come through. Please try again." }, 400); }
  const idea = String(body.idea || "").replace(/[\u0000-\u001f<>{}\[\]\\`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const style = STYLES[body.style] ? body.style : "whimsical";
  if (idea.length < 4) return json({ error: "short", message: "Tell us a little more about what to draw." }, 400);
  if (BLOCK.test(idea)) return json({ error: "blocked", message: "We can't draw that one. Try a different idea." }, 400);
  if (NAMES.test(idea)) return json({ error: "named", message: "We can't draw characters, brands or real people. Describe your own instead, like “a friendly yellow electric mouse”." }, 400);

  // Human check (Turnstile). Only enforced once its secret is set on the Worker.
  if (env.TURNSTILE_SECRET) {
    const token = String(body.ts || "");
    let human = false;
    if (token && token.length <= 2048) {
      try {
        const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: q.headers.get("cf-connecting-ip") || "" }) });
        const j = await v.json();
        human = !!j.success && j.hostname === HOME;
      } catch (e) { human = false; }
    }
    if (!human) return json({ error: "human", message: "We could not confirm you are a person. Please try again." }, 403);
  }

  const c = await counts(env, q.headers.get("cf-connecting-ip") || "0");
  // One free do-over per drawing: a first drawing hands back a one-time code, and a request carrying
  // that code skips the visitor's daily limit (it still counts toward the site-wide cap).
  const redoKey = /^[a-f0-9]{24}$/.test(String(body.redo || "")) ? "redo:" + body.redo : "";
  let free = false;
  if (redoKey && (await env.KV.get(redoKey))) { free = true; await env.KV.delete(redoKey); }
  if (!free && c.mine >= c.limIp) return json({ error: "limit", message: "That is your " + c.limIp + " free instant pages for today. Come back tomorrow!" }, 429);
  if (c.all >= c.limDay) {
    if (free) await env.KV.put(redoKey, "1", { expirationTtl: 86400 });
    return json({ error: "busy", message: "Our crayons are worn out for today. Send it as a request and we'll draw it soon." }, 429);
  }

  const auth = { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" };
  // Text safety check first. If the check itself fails, we stop: this is a kids' site.
  let flagged = true;
  try {
    const m = await fetch("https://api.openai.com/v1/moderations", { method: "POST", headers: auth, body: JSON.stringify({ model: "omni-moderation-latest", input: idea }) });
    if (m.ok) { const j = await m.json(); flagged = !!(j.results && j.results[0] && j.results[0].flagged); }
    else if (m.status === 401 || m.status === 429) return json({ error: "upstream", message: "The drawing machine is resting. Please try again later." }, 503);
  } catch (e) { flagged = true; }
  if (flagged) {
    if (free) await env.KV.put(redoKey, "1", { expirationTtl: 86400 });
    return json({ error: "blocked", message: "We can't draw that one. Try a different idea." }, 400);
  }

  // Count the attempt before drawing so a burst of clicks cannot run past the limits.
  const ttl = { expirationTtl: 172800 };
  await Promise.all([free ? null : env.KV.put(c.ipKey, String(c.mine + 1), ttl), env.KV.put(c.dayKey, String(c.all + 1), ttl)]);

  const prompt = promptFor(idea, style);
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: auth,
    body: JSON.stringify({ model: env.IMAGE_MODEL || "gpt-image-2.6-flare", prompt, size: "1024x1536", quality: env.QUALITY || "medium", n: 1, output_format: "webp", output_compression: 92, background: "opaque", moderation: "auto", safety_identifier: c.ipKey.slice(-24) }),
  });
  if (!r.ok) {
    // Give the visitor their turn back; the site-wide count stays (it guards spending).
    if (free) await env.KV.put(redoKey, "1", { expirationTtl: 86400 }); else await env.KV.put(c.ipKey, String(c.mine), ttl);
    let why = ""; try { const e = await r.json(); why = (e.error && (e.error.code || e.error.type)) || ""; } catch (e) {}
    if (r.status === 400 && /moderation|safety|content_policy/i.test(why)) return json({ error: "blocked", message: "We can't draw that one. Try a different idea." }, 400);
    console.log("image error", r.status, why);
    return json({ error: "upstream", message: "The drawing did not come out. Please try again in a minute." }, 502);
  }
  // Pass OpenAI's JSON straight through (the picture is in data[0].b64_json). No re-encoding here.
  const out = { "content-type": "application/json", "cache-control": "no-store", "x-left": String(Math.max(0, c.limIp - c.mine - (free ? 0 : 1))) };
  if (!free) {
    const code = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.KV.put("redo:" + code, "1", { expirationTtl: 86400 });
    out["x-redo"] = code;
  }
  return new Response(r.body, { status: 200, headers: out });
}

// ---------- shared helpers ----------
const b64ToBytes = (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const bytesToB64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
const rid = (n) => [...crypto.getRandomValues(new Uint8Array(n || 12))].map((b) => b.toString(16).padStart(2, "0")).join("");
const okOrigin = (q) => { const o = q.headers.get("origin") || ""; return !o || o === "https://" + HOME; };
function same(a, b) { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// Draw one image. refs: array of {bytes, type} to edit from (keeps a character or a drawing the same).
// Falls back to the standard 1024x1536 size if the model refuses a custom size.
async function drawImage(env, prompt, o) {
  o = o || {};
  const model = o.model || env.IMAGE_MODEL || "gpt-image-2.6-flare";
  const fmt = o.format || "jpeg";
  const tries = [o.size || "1024x1536"]; if (tries[0] !== "1024x1536") tries.push("1024x1536");
  let last = "";
  for (const size of tries) {
    let r;
    if (o.refs && o.refs.length) {
      const f = new FormData();
      f.append("model", model); f.append("prompt", prompt); f.append("size", size); f.append("quality", o.quality || "medium");
      f.append("output_format", fmt); f.append("n", "1");
      o.refs.forEach((x, i) => f.append("image[]", new Blob([x.bytes], { type: x.type || "image/jpeg" }), "ref" + i + "." + ((x.type || "").split("/")[1] || "jpg")));
      r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY }, body: f });
    } else {
      r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality: o.quality || "medium", n: 1, output_format: fmt, background: "opaque", moderation: "auto", safety_identifier: o.who || undefined }),
      });
    }
    if (r.ok) { const j = await r.json(); const b = j.data && j.data[0] && j.data[0].b64_json; if (b) return { ok: true, bytes: b64ToBytes(b), size, type: "image/" + fmt }; last = "empty"; continue; }
    let why = ""; try { const e = await r.json(); why = (e.error && (e.error.code || e.error.type || e.error.message)) || ""; } catch (e) {}
    last = r.status + " " + why;
    if (r.status === 400 && /moderation|safety|content_policy/i.test(why)) return { ok: false, blocked: true, why: last };
    if (!(r.status === 400 && /size|dimension|resolution/i.test(why))) break;
  }
  return { ok: false, why: last };
}

// ---------- hearts ----------
const PID = /^[a-z]+-\d{2,3}$/;
async function heartsAll(q, env, ctx) {
  const cache = caches.default, key = new Request("https://" + HOME + "/api/hearts?c=1");
  const hit = await cache.match(key); if (hit) return hit;
  const counts = {}; let cursor = undefined;
  do {
    const l = await env.KV.list({ prefix: "heart:", cursor });
    for (const k of l.keys) { const n = k.metadata && k.metadata.n; if (n > 0) counts[k.name.slice(6)] = n; }
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  const r = json({ counts }, 200, { "cache-control": "public, max-age=300" });
  ctx.waitUntil(cache.put(key, r.clone()));
  return r;
}
async function heart(q, env) {
  if (!okOrigin(q)) return json({ error: "origin" }, 403);
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad" }, 400); }
  const id = String(b.id || ""); if (!PID.test(id)) return json({ error: "bad" }, 400);
  const who = await sha((q.headers.get("cf-connecting-ip") || "0") + "|heart");
  const vk = "hv:" + id + ":" + who, ck = "heart:" + id;
  const [had, cur] = await Promise.all([env.KV.get(vk), env.KV.getWithMetadata(ck)]);
  let n = (cur && cur.metadata && cur.metadata.n) || 0;
  if (b.on && !had) { n += 1; await Promise.all([env.KV.put(vk, "1"), env.KV.put(ck, "", { metadata: { n } })]); }
  else if (!b.on && had) { n = Math.max(0, n - 1); await Promise.all([env.KV.delete(vk), env.KV.put(ck, "", { metadata: { n } })]); }
  return json({ n });
}

// ---------- team (Uncle Dave) ----------
const THEMES = ["requests", "thanksgiving", "christmas", "halloween", "easter", "valentines", "summer", "holidays", "dinosaurs", "ocean", "animals", "space", "fantasy"];
// Only a SHA-256 hash of the team key lives here (this file is public). Nate gives Dave the key itself.
const TEAM_KEY_HASH = "5ad07b58cbecc476661b2c214ee9a7bd37ba9903ca91519ea9cdd402673a8942";
async function hex256(t) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t || ""))); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function keyOk(k, hash) { return !!k && !!hash && same(await hex256(k), hash); }
const teamOk = (q, env, k) => keyOk(k || q.headers.get("x-team-key"), env.TEAM_KEY_HASH || TEAM_KEY_HASH);
// Team drawings are stored without decoding (the free Workers plan allows only a few ms of CPU per request):
// a drawn page is kept as OpenAI's JSON (picture in data[0].b64_json), an upload as the raw image bytes.
async function teamMake(q, env, ctx) {
  if (!env.OPENAI_API_KEY) return json({ error: "off", message: "Drawing is switched off." }, 503);
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad", message: "That did not come through." }, 400); }
  const idea = cleanIdea(b.idea, 400), style = STYLES[b.style] ? b.style : "whimsical";
  if (idea.length < 4) return json({ error: "short", message: "Say a little more about the picture." }, 400);
  if (BLOCK.test(idea)) return json({ error: "blocked", message: "That has a word we can't use on a kids' site." }, 400);
  if (NAMES.test(idea)) return json({ error: "named", message: "No characters, brands or real people. Describe your own version instead." }, 400);
  const dk = "team:day:" + today(), used = num(await env.KV.get(dk), 0), lim = num(env.TEAM_LIMIT, 40);
  if (used >= lim) return json({ error: "limit", message: "That's " + lim + " drawings today. More tomorrow." }, 429);
  const mod = await moderate(env, idea);
  if (mod === "upstream") return json({ error: "upstream", message: "The drawing machine is resting. Try again later." }, 503);
  if (mod) return json({ error: "blocked", message: "The safety check said no to that one. Try different words." }, 400);
  await env.KV.put(dk, String(used + 1), { expirationTtl: 172800 });
  const body = { model: env.IMAGE_MODEL || "gpt-image-2.6-flare", prompt: promptFor(idea, style), size: env.TEAM_SIZE || "1536x2048", quality: env.TEAM_QUALITY || "high", n: 1, output_format: "png", background: "opaque", moderation: "auto" };
  const call = (bd) => fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify(bd) });
  let r = await call(body);
  if (!r.ok && r.status === 400) { body.size = "1024x1536"; r = await call(body); }
  if (!r.ok) {
    let why = ""; try { const e = await r.json(); why = (e.error && (e.error.code || e.error.message)) || ""; } catch (e) {}
    const blocked = /moderation|safety|content_policy/i.test(why);
    return json({ error: blocked ? "blocked" : "upstream", message: blocked ? "The safety check said no to that one. Try different words." : "The drawing did not come out (" + r.status + " " + String(why).slice(0, 80) + "). Try again." }, blocked ? 400 : 502);
  }
  const tid = "t" + rid(6);
  const [a, c] = r.body.tee();
  ctx.waitUntil(env.KV.put("team:img:" + tid, a, { expirationTtl: 1209600, metadata: { type: "application/json", idea, style, at: Date.now() } }));
  return new Response(c, { headers: { "content-type": "application/json", "cache-control": "no-store", "x-team-id": tid, "x-left": String(lim - used - 1), "access-control-expose-headers": "x-team-id, x-left" } });
}
async function teamUpload(q, env) {
  const type = (q.headers.get("content-type") || "").split(";")[0];
  if (!/^image\/(png|jpeg|webp)$/.test(type)) return json({ error: "bad", message: "Send a PNG, JPG or WEBP picture." }, 400);
  if (num(q.headers.get("content-length"), 0) > 8e6) return json({ error: "big", message: "That picture is over 8 MB." }, 400);
  const tid = "t" + rid(6);
  await env.KV.put("team:img:" + tid, q.body, { expirationTtl: 1209600, metadata: { type, idea: "(uploaded)", style: "", at: Date.now() } });
  return json({ tid, type });
}
async function teamPublish(q, env) {
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad", message: "That did not come through." }, 400); }
  const tid = /^t[a-f0-9]{12}$/.test(String(b.tid || "")) ? b.tid : "";
  const title = cleanIdea(b.title, 40).replace(/[^A-Za-z0-9 '&!,.-]/g, "").trim();
  const subject = cleanIdea(b.subject, 300);
  const theme = THEMES.indexOf(b.theme) >= 0 ? b.theme : "requests", style = STYLES[b.style] ? b.style : "whimsical";
  if (!tid || !(await env.KV.getWithMetadata("team:img:" + tid, "stream")).value) return json({ error: "gone", message: "That drawing is no longer saved. Draw it again." }, 400);
  if (title.length < 3) return json({ error: "title", message: "Give the page a title (3 to 40 letters)." }, 400);
  if (subject.length < 8) return json({ error: "subject", message: "Add a sentence describing the picture (it becomes the page's description)." }, 400);
  if (NAMES.test(title + " " + subject) || BLOCK.test(title + " " + subject)) return json({ error: "named", message: "The title or description has a word we can't use." }, 400);
  const item = { tid, title, subject, theme, style, by: "team", at: new Date().toISOString() };
  await env.KV.put("team:pub:" + tid, JSON.stringify(item), { expirationTtl: 1209600 });
  return json({ ok: true, item });
}
async function teamLive(env) {
  // team.json on the site maps a published drawing (tid) to its page id once the Action has added it.
  try { const r = await fetch(SRC + "/team.json?t=" + Date.now(), { cf: { cacheTtl: 30 } }); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
}
async function teamQueue(env) {
  const live = await teamLive(env), out = [];
  const l = await env.KV.list({ prefix: "team:pub:" });
  for (const k of l.keys) {
    const tid = k.name.slice(9);
    if (live[tid]) continue;
    const it = await env.KV.get(k.name, "json"); if (!it) continue;
    it.img = "https://" + HOME + "/api/team/img/" + tid; out.push(it);
  }
  return json({ items: out });
}
async function teamList(env) {
  const live = await teamLive(env), out = [];
  const l = await env.KV.list({ prefix: "team:img:" });
  for (const k of l.keys) { const tid = k.name.slice(9), md = k.metadata || {}; out.push({ tid, idea: md.idea, style: md.style, at: md.at, live: live[tid] || "" }); }
  const pubs = await env.KV.list({ prefix: "team:pub:" }); const pub = {}; pubs.keys.forEach((k) => { pub[k.name.slice(9)] = 1; });
  out.forEach((x) => { x.published = !!pub[x.tid] || !!x.live; });
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return json({ items: out.slice(0, 60) });
}
async function teamImg(tid, env) {
  if (!/^t[a-f0-9]{12}$/.test(tid)) return new Response("not found", { status: 404 });
  const v = await env.KV.getWithMetadata("team:img:" + tid, "stream");
  if (!v || !v.value) return new Response("not found", { status: 404 });
  // A drawn page comes back as OpenAI's JSON ({data:[{b64_json}]}); the team page and the Action decode it.
  return new Response(v.value, { headers: { "content-type": (v.metadata && v.metadata.type) || "image/png", "cache-control": "no-store" } });
}
async function team(q, env, u, ctx) {
  const path = u.pathname.slice(10); // after /api/team/
  if (path === "queue" && q.method === "GET") return teamQueue(env);
  if (path.startsWith("img/") && q.method === "GET") {
    // Published drawings are public (they are about to be on the site); unpublished ones need the key.
    const tid = path.slice(4);
    if (!(await teamOk(q, env, u.searchParams.get("k"))) && !(await env.KV.get("team:pub:" + tid))) return new Response("not found", { status: 404 });
    return teamImg(tid, env);
  }
  if (!(await teamOk(q, env))) return json({ error: "key", message: "That team key is not right." }, 403);
  if (path === "check") return json({ ok: true });
  if (path === "list") return teamList(env);
  if (q.method !== "POST") return json({ error: "method" }, 405);
  if (path === "make") return teamMake(q, env, ctx);
  if (path === "upload") return teamUpload(q, env);
  if (path === "publish") return teamPublish(q, env);
  return json({ error: "nope" }, 404);
}

// =====================================================================================================
// PAID BOOKS (runs itself). Rules Nate approved Nov 27, 2026:
//  - Order confirmation and shipped-with-tracking emails go out automatically from hello@.
//  - Reprint/refund only inside a fixed policy: misprint or damage = free reprint; lost after the
//    delivery window = reprint or full refund; capped at the order amount; one per order.
//  - Anything else (angry, chargeback, legal, odd) waits for Nate: an alert goes to hello@.
// Needs: secret STRIPE_SECRET (restricted key), LULU_CLIENT_KEY/SECRET, OPENAI_API_KEY, KV, a cron trigger
// (every minute), and the mailer (Apps Script in the hello@ Workspace polls /api/mail/outbox).
// =====================================================================================================
const POD = "0850X1100BWSTDPB060UW444MXX"; // US Letter, B&W standard, perfect bound, 60# white, matte
const PRODUCTS = {
  kid: { name: "A coloring book starring your kid", price: 2999, n: 24, gen: true },
  idea: { name: "A whole coloring book of your idea", price: 2999, n: 24, gen: true },
  joke: { name: "An inside-joke coloring book", price: 3499, n: 24, gen: true },
  picked: { name: "Your coloring pages, printed and mailed", price: 1999, gen: false, max: 40 },
};
const RUSH_PRICE = 1500;
const SHIP = {
  std: { lulu: "MAIL", label: "Standard shipping", eta: "about 2 to 3 weeks", lostDays: 35 },
  rush: { lulu: "EXPEDITED", label: "Faster shipping", eta: "about 1 to 2 weeks", lostDays: 18 },
};
const PRINT_SIZE = "1728x2304";
const LIM_PREVIEW_IP = 4, LIM_PREVIEW_DAY = 40;
const OID = /^MCB-[A-Z2-9]{6}$/;
const TOK = /^[a-f0-9]{32}$/;
const MAIL_KEY_HASH = "adb77d2eedcbaa935c6a9c4893423aa2acb3b8830577fe0e4cfa08def0579f06";
const DAY = 86400;
const newOid = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return "MCB-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => a[b % 32]).join(""); };
const money = (c) => "$" + (c / 100).toFixed(2);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const helpUrl = (o) => "https://" + HOME + "/order/help/?order=" + o.id;

// ---------- storage ----------
const oKey = (id) => "o:" + id, iKey = (id, n) => "oi:" + id + ":" + n;
const oTtl = (o) => (o.status === "draft" ? 3 * DAY : 200 * DAY);
async function oGet(env, id) { return OID.test(String(id || "")) ? await env.KV.get(oKey(id), "json") : null; }
async function oPut(env, o) { o.updated = Date.now(); await env.KV.put(oKey(o.id), JSON.stringify(o), { expirationTtl: oTtl(o) }); }
async function iPut(env, o, n, data, type) { await env.KV.put(iKey(o.id, n), data, { expirationTtl: oTtl(o), metadata: { type: type || "image/jpeg" } }); o.have = o.have || {}; o.have[n] = 1; }
const iGet = (env, id, n) => env.KV.get(iKey(id, n), "arrayBuffer");
function log(o, t) { (o.log = o.log || []).push(new Date().toISOString().slice(0, 16) + " " + t); if (o.log.length > 40) o.log.shift(); }
async function activeGet(env) { return (await env.KV.get("orders:active", "json")) || []; }
async function activeSet(env, id, on) {
  const a = await activeGet(env), i = a.indexOf(id);
  if (on && i < 0) a.push(id); else if (!on && i >= 0) a.splice(i, 1); else return;
  await env.KV.put("orders:active", JSON.stringify(a));
}
async function kvHas(env, k) { const s = await env.KV.get(k, "stream"); if (!s) return false; try { await s.cancel(); } catch (e) {} return true; }
async function owned(env, id, tok) { const o = await oGet(env, id); return o && TOK.test(String(tok || "")) && same(o.tok, tok) ? o : null; }

// ---------- email (queued; the Apps Script mailer sends them from hello@) ----------
const SIGN = "\n\nMake a Coloring Book\nhello@makeacoloringbook.com\nhttps://makeacoloringbook.com";
async function mail(env, to, subject, text, order) {
  const k = "mail:" + Date.now() + "-" + rid(4);
  await env.KV.put(k, JSON.stringify({ to, subject, text: text + SIGN, order: order || "" }), { expirationTtl: 14 * DAY });
}
async function alertNate(env, o, why, detail) {
  if (o) { o.needsNate = why; log(o, "NEEDS NATE: " + why); }
  await mail(env, "hello@makeacoloringbook.com", "Needs Nate: " + (o ? o.id + " " : "") + why,
    (detail || "") + (o ? "\n\nOrder " + o.id + " (" + (PRODUCTS[o.product] || {}).name + ", " + (o.title || "") + ")\nStatus: " + o.status + "\nCustomer: " + ((o.pay && o.pay.email) || "") + "\nLog:\n" + (o.log || []).join("\n") : ""), o ? o.id : "");
}
const MAILS = {
  confirm: (o) => ["Your coloring book order " + o.id,
    "Hi " + first(o.pay.name) + ",\n\nThanks for your order! Here's what happens next:\n\n" +
    "- We draw and print \"" + o.title + "\" (" + o.n + " coloring pages).\n" +
    "- It ships " + (o.ship === "rush" ? "with faster shipping" : "with free standard shipping") + ". Most orders arrive in " + SHIP[o.ship].eta + ".\n" +
    "- We'll email you the tracking link as soon as it ships.\n\n" +
    "Order: " + o.id + "\nTotal: " + money(o.pay.amount) + "\nShips to: " + o.pay.ship.name + ", " + o.pay.ship.city + ", " + o.pay.ship.state + "\n\n" +
    "Something wrong when it arrives? Tell us here and we'll make it right: " + helpUrl(o)],
  shipped: (o) => ["Your coloring book is on the way (" + o.id + ")",
    "Hi " + first(o.pay.name) + ",\n\n\"" + o.title + "\" just shipped!\n\nTrack it here: " + (o.lulu.url || "(tracking link coming soon)") +
    (o.lulu.tracking ? "\n" + (o.lulu.carrier ? o.lulu.carrier + " " : "") + "tracking number: " + o.lulu.tracking : "") +
    "\n\nIf it hasn't arrived by " + new Date(o.lulu.shippedAt + SHIP[o.ship].lostDays * DAY * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric" }) +
    ", or it arrives damaged or misprinted, tell us here and we'll fix it: " + helpUrl(o)],
  reprint: (o) => ["We're reprinting your book (" + o.id + ")",
    "Hi " + first(o.pay.name) + ",\n\nSorry about that. We're printing a new copy of \"" + o.title + "\" at no charge and sending it to the same address. " +
    "We'll email the tracking link when it ships. No need to send anything back."],
  refund: (o) => ["Your refund for order " + o.id,
    "Hi " + first(o.pay.name) + ",\n\nWe've refunded " + money(o.problem.refunded) + " to your card. It usually shows up in 5 to 10 business days. Sorry your book didn't make it."],
};
async function send(env, o, kind) { const m = MAILS[kind](o); await mail(env, o.pay.email, m[0], m[1], o.id); (o.mailed = o.mailed || {})[kind] = Date.now(); log(o, "email " + kind); }
async function mailbox(q, env, u) {
  if (!(await keyOk(q.headers.get("x-mail-key"), env.MAIL_KEY_HASH || MAIL_KEY_HASH))) return json({ error: "key" }, 403);
  if (u.pathname === "/api/mail/outbox") {
    const l = await env.KV.list({ prefix: "mail:", limit: 20 }); const out = [];
    for (const k of l.keys) { const m = await env.KV.get(k.name, "json"); if (m) { m.id = k.name; out.push(m); } }
    return json({ mails: out });
  }
  if (u.pathname === "/api/mail/sent" && q.method === "POST") {
    const b = await q.json().catch(() => ({})); for (const id of b.ids || []) if (/^mail:\d+-[a-f0-9]{8}$/.test(id)) await env.KV.delete(id);
    return json({ ok: true });
  }
  return json({ error: "nope" }, 404);
}

// ---------- OpenAI text planning ----------
const PLAN_SCHEMA = { type: "object", additionalProperties: false, required: ["title", "dedication", "character", "pages"], properties: {
  title: { type: "string" }, dedication: { type: "string" }, character: { type: "string" },
  pages: { type: "array", items: { type: "object", additionalProperties: false, required: ["caption", "scene"], properties: { caption: { type: "string" }, scene: { type: "string" } } } } } };
const PLAN_RULES = "You plan personalized coloring books for a family-friendly print shop. Every scene must work as black-and-white line art: one clear moment, a full scene, no text, signs, letters or numbers in the picture. " +
  "Never use characters from movies, TV, books, games or toys, real celebrities, sports teams, brands or logos: replace any the customer mentions with an original generic version (for example 'a friendly blue cartoon puppy'). " +
  "Nothing scary, violent, romantic, crude or unkind. Describe the main character once in 'character' (age, build, hair, face, glasses, usual outfit) so an illustrator draws them the same on every page; use only looks the customer gave plus neutral clothing. Use names exactly as written.";
async function askJSON(env, system, user) {
  const models = [env.TEXT_MODEL || "gpt-5-mini", "gpt-4.1-mini"];
  for (const model of models) {
    const body = { model, input: [{ role: "system", content: system }, { role: "user", content: user }], text: { format: { type: "json_schema", name: "plan", schema: PLAN_SCHEMA, strict: true } } };
    if (/^(gpt-5|o\d)/.test(model)) body.reasoning = { effort: "low" };
    const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { console.log("plan", model, r.status, (await r.text()).slice(0, 300)); continue; }
    const j = await r.json(); let t = j.output_text || "";
    if (!t && j.output) for (const it of j.output) for (const c of it.content || []) if (c.type === "output_text") t += c.text;
    try { return JSON.parse(t); } catch (e) { console.log("plan parse", model, t.slice(0, 200)); }
  }
  return null;
}
const clip = (t, n) => cleanIdea(t, n);
function planPrompt(o) {
  const f = o.form;
  if (o.product === "kid") return "Make a 24-page coloring book starring a child.\nName: " + f.name + "\nAge: " + f.age + "\nWhat they look like: " + f.looks + "\nFavorite things: " + f.likes + "\nPet (if any): " + f.pet + "\nBest friend (if any): " + f.friend + "\nOccasion: " + (f.occasion || "just because") +
    "\n\ntitle: at most 36 characters, includes the child's name exactly as written (like \"Maya's Big Coloring Adventure\").\ndedication: at most 60 characters for the title page (like \"Made for Maya, age 6\" or \"Happy 6th birthday, Maya!\").\npages: exactly 24. caption: 2 to 6 words. scene: one or two sentences. The child is in nearly every scene, doing things with their favorite things in varied places; the pet and best friend appear in some; include the occasion if one was given; the last page is a happy ending.";
  if (o.product === "joke") return "Make a 24-page inside-joke coloring book for an adult, as a funny, affectionate gift.\nWho it's for: " + f.name + "\nWho they are: " + f.who + "\nWhat they look like: " + f.looks + "\nInside jokes, hobbies and things they're known for: " + f.jokes + "\nFrom: " + f.from + "\nOccasion: " + (f.occasion || "just because") +
    "\n\nGentle teasing is fine; nothing sexual, crude, hateful, about drugs, or unkind about weight, looks, age, health or identity. Draw them as a friendly cartoon.\ntitle: at most 36 characters, includes their name. dedication: at most 60 characters like \"For Dave, from Nate\".\npages: exactly 24, each built on one of the jokes or hobbies, varied and funny; caption 2 to 6 words; scene one or two sentences.";
  return "Make a coloring book around this idea: \"" + f.idea + "\"" + (f.name ? " for " + f.name : "") + ". Page 1 is the customer's own drawing of the idea.\n\n" +
    "title: at most 36 characters, from the idea" + (f.name ? ", may include " + f.name : "") + ". dedication: at most 60 characters.\ncharacter: describe the main subject so it looks the same on every page.\npages: exactly 23 new scenes (pages 2 to 24) with the same main subject doing different fun things in different places; caption 2 to 6 words; scene one or two sentences.";
}
function levelFor(o) {
  if (o.product === "kid") { const a = parseInt(o.form.age, 10) || 6; return a <= 4 ? "easy" : a <= 9 ? "whimsical" : "realistic"; }
  if (o.product === "joke") return "whimsical";
  return STYLES[o.form.level] ? o.form.level : "whimsical";
}
function pagePrompt(o, n) {
  const sc = o.scenes[n - 1];
  return (n > 1 ? "Use the attached coloring page only as the model for how the main character looks (same face, hair, build and outfit); draw a completely new picture of this scene. " : "") +
    "Black and white coloring book page, portrait orientation. Scene: " + sc.scene + (o.character ? " Main character: " + o.character : "") + " " + STYLES[o.level] + " " + WHOLE + " " + TAIL + " " + RULES;
}
function coverPrompt(o) {
  return "Turn the attached coloring page into a full-color children's picture book cover illustration: the same main character, bright cheerful flat colors with clean outlines, a fun scene that sums up a book called \"" + o.title + "\". " +
    "Keep the top third of the picture simple open sky or plain background, because a title will be printed there. No text, letters, words, numbers or logos anywhere. Full bleed, no border, no frame. " + RULES;
}

// ---------- drafts and previews ----------
async function human(q, env, token) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token || String(token).length > 2048) return false;
  try {
    const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: q.headers.get("cf-connecting-ip") || "" }) });
    const j = await v.json(); return !!j.success && j.hostname === HOME;
  } catch (e) { return false; }
}
async function previewSlot(q, env) {
  const day = today(), ipk = "pv:" + day + ":" + (await sha((q.headers.get("cf-connecting-ip") || "0") + "|pv")), dk = "pvday:" + day;
  const [a, b] = await Promise.all([env.KV.get(ipk), env.KV.get(dk)]);
  if (num(a, 0) >= num(env.LIMIT_PREVIEW_IP, LIM_PREVIEW_IP) || num(b, 0) >= num(env.LIMIT_PREVIEW_DAY, LIM_PREVIEW_DAY)) return false;
  await Promise.all([env.KV.put(ipk, String(num(a, 0) + 1), { expirationTtl: 2 * DAY }), env.KV.put(dk, String(num(b, 0) + 1), { expirationTtl: 2 * DAY })]);
  return true;
}
// Orders are public only when var ORDERS_LIVE is "1". Before that, a browser with the cookie mcb_team=<team key> can test.
async function ordersOpen(q, env) {
  if (!env.STRIPE_SECRET) return false;
  if (env.ORDERS_LIVE === "1") return true;
  const m = /(?:^|;\s*)mcb_team=([^;]+)/.exec(q.headers.get("cookie") || "");
  return !!m && (await teamOk(q, env, decodeURIComponent(m[1])));
}
async function orderDraft(q, env) {
  if (!(await ordersOpen(q, env)) || !env.OPENAI_API_KEY) return json({ error: "off", message: "Printed books are not open yet. Check back soon!" }, 503);
  if (!okOrigin(q)) return json({ error: "origin" }, 403);
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad", message: "That did not come through." }, 400); }
  const product = PRODUCTS[b.product] ? b.product : "";
  if (!product) return json({ error: "bad", message: "Pick a book first." }, 400);
  if (!(await human(q, env, b.ts))) return json({ error: "human", message: "We could not confirm you are a person. Please try again." }, 403);
  const f = {}; const src = b.form || {};
  ["name", "age", "looks", "likes", "pet", "friend", "occasion", "who", "jokes", "from", "idea", "level", "title"].forEach((k) => { f[k] = clip(src[k], k === "jokes" || k === "likes" || k === "looks" || k === "who" ? 500 : 120); });
  const need = { kid: ["name", "age", "looks", "likes"], joke: ["name", "looks", "jokes", "from"], idea: ["idea"], picked: [] }[product];
  for (const k of need) if (!f[k]) return json({ error: "missing", field: k, message: "Please fill in every box marked *." }, 400);
  const all = Object.values(f).join(" \n ");
  if (BLOCK.test(all)) return json({ error: "blocked", message: "Something in there is a word we can't print. Please reword it." }, 400);
  if (all.trim()) { const m = await moderate(env, all); if (m === "upstream") return json({ error: "upstream", message: "Our drawing machine is resting. Please try again in a few minutes." }, 503); if (m) return json({ error: "blocked", message: "Our safety check didn't like something in there. Please reword it." }, 400); }
  if (!(await previewSlot(q, env))) return json({ error: "limit", message: "That's all the free previews for today. Come back tomorrow, or email hello@makeacoloringbook.com." }, 429);
  const o = { id: newOid(), tok: rid(16), ptok: rid(16), product, status: "draft", created: Date.now(), form: f, have: {}, redraws: 0 };
  if (product === "picked") {
    const count = Math.max(1, Math.min(PRODUCTS.picked.max, parseInt(b.count, 10) || 0));
    o.n = count; o.title = clip(f.title, 40) || "My Coloring Book"; o.level = "whimsical"; o.scenes = [];
  } else {
    o.level = levelFor(o);
    const plan = await askJSON(env, PLAN_RULES, planPrompt(o));
    if (!plan || !plan.pages || plan.pages.length < 10) return json({ error: "upstream", message: "We couldn't plan the book just now. Please try again." }, 502);
    const want = product === "idea" ? 23 : 24;
    const pages = plan.pages.slice(0, want).map((p) => ({ caption: clip(p.caption, 60), scene: clip(p.scene, 400) }));
    while (pages.length < want) pages.push(pages[pages.length % Math.max(1, pages.length)]);
    o.scenes = product === "idea" ? [{ caption: "Where it started", scene: f.idea }].concat(pages) : pages;
    o.n = o.scenes.length; o.title = clip(plan.title, 40); o.dedication = clip(plan.dedication, 70); o.character = clip(plan.character, 400);
  }
  log(o, "draft " + product);
  await oPut(env, o);
  return json({ id: o.id, tok: o.tok, title: o.title, dedication: o.dedication || "", n: o.n, captions: (o.scenes || []).map((s) => s.caption) });
}
// The browser sends JPEGs it made (page 1 for "idea"; cover and every page for "picked"). Stored without decoding.
async function orderUpload(q, env, u) {
  const o = await owned(env, u.searchParams.get("id"), u.searchParams.get("tok"));
  if (!o || o.status !== "draft") return json({ error: "gone", message: "That order is no longer open." }, 404);
  const n = u.searchParams.get("n");
  const okN = n === "c" ? o.product === "picked" : (o.product === "picked" ? +n >= 1 && +n <= o.n : o.product === "idea" && n === "1");
  if (!okN) return json({ error: "bad" }, 400);
  if ((q.headers.get("content-type") || "") !== "image/jpeg") return json({ error: "bad", message: "Pages must be JPEG." }, 400);
  const len = num(q.headers.get("content-length"), 0); if (!len || len > 9e6) return json({ error: "big" }, 400);
  await env.KV.put(iKey(o.id, n), q.body, { expirationTtl: oTtl(o), metadata: { type: "image/jpeg" } });
  return json({ ok: true });
}
async function drawPage(env, o, n) {
  // n = page number, or "c" for the color cover art. Page 1 of "idea" is the customer's drawing (uploaded).
  let prompt, refs = null, size = PRINT_SIZE;
  if (n === "c") { const p1 = await iGet(env, o.id, 1); if (!p1) return { ok: false, why: "no page 1" }; refs = [{ bytes: p1, type: "image/jpeg" }]; prompt = coverPrompt(o); size = "1536x2048"; }
  else { prompt = pagePrompt(o, n); if (n > 1) { const p1 = await iGet(env, o.id, 1); if (p1) refs = [{ bytes: p1, type: "image/jpeg" }]; } }
  const d = await drawImage(env, prompt, { size, quality: env.PRINT_QUALITY || "medium", format: "jpeg", refs, who: "order-" + o.id });
  if (d.ok) await iPut(env, o, n, d.bytes, "image/jpeg");
  return d;
}
async function orderPreview(q, env) {
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad" }, 400); }
  const o = await owned(env, b.id, b.tok);
  if (!o || o.status !== "draft" || !PRODUCTS[o.product].gen) return json({ error: "gone", message: "That preview has expired. Start again." }, 404);
  const redo = b.redo === "c" || b.redo === 1 || b.redo === 2 ? b.redo : null;
  if (redo) { if (o.redraws >= 3) return json({ error: "limit", message: "That's all the redraws for this preview." }, 429); o.redraws++; delete o.have[redo]; }
  if (!o.have[1] && o.product === "idea" && (await kvHas(env, iKey(o.id, 1)))) o.have[1] = 1;
  const jobs = [];
  if (!o.have[1]) { const d = await drawPage(env, o, 1); if (!d.ok) return json({ error: d.blocked ? "blocked" : "upstream", message: d.blocked ? "Our safety check stopped a page. Try rewording." : "A page didn't come out. Please try again." }, 502); }
  if (!o.have.c) jobs.push(drawPage(env, o, "c"));
  if (!o.have[2]) jobs.push(drawPage(env, o, 2));
  await Promise.all(jobs);
  await oPut(env, o);
  return json({ have: Object.keys(o.have) });
}
async function orderImg(env, u) {
  const m = /^\/api\/order\/img\/(MCB-[A-Z2-9]{6})\/(c|\d{1,2})$/.exec(u.pathname); if (!m) return new Response("no", { status: 404 });
  const o = await owned(env, m[1], u.searchParams.get("tok")); if (!o) return new Response("no", { status: 404 });
  const v = await iGet(env, o.id, m[2]); if (!v) return new Response("no", { status: 404 });
  return new Response(v, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
}

// ---------- Stripe ----------
async function stripe(env, method, path, pairs) {
  const r = await fetch("https://api.stripe.com/v1" + path, { method, headers: { authorization: "Bearer " + env.STRIPE_SECRET, "content-type": "application/x-www-form-urlencoded" }, body: pairs ? new URLSearchParams(pairs).toString() : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) console.log("stripe", path, r.status, JSON.stringify(j).slice(0, 300));
  return r.ok ? j : null;
}
async function orderCheckout(q, env) {
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad" }, 400); }
  const o = await owned(env, b.id, b.tok);
  if (!o || o.status !== "draft") return json({ error: "gone", message: "That order is no longer open. Start again." }, 404);
  if (o.product === "picked") { for (const n of ["c"].concat([...Array(o.n)].map((_, i) => i + 1))) if (!(await kvHas(env, iKey(o.id, n)))) return json({ error: "pages", message: "Some pages didn't upload. Please try again." }, 400); }
  else if (!o.have[1] || !o.have.c) return json({ error: "preview", message: "Make the preview first." }, 400);
  const P = PRODUCTS[o.product], back = "https://" + HOME + "/order/?id=" + o.id + "&tok=" + o.tok;
  const pairs = [["mode", "payment"], ["success_url", back + "&paid=1"], ["cancel_url", back], ["client_reference_id", o.id], ["metadata[order]", o.id], ["payment_intent_data[metadata][order]", o.id],
    ["payment_intent_data[description]", P.name + " (" + o.id + ")"],
    ["line_items[0][quantity]", "1"], ["line_items[0][price_data][currency]", "usd"], ["line_items[0][price_data][unit_amount]", String(P.price)],
    ["line_items[0][price_data][product_data][name]", P.name], ["line_items[0][price_data][product_data][description]", "\"" + o.title + "\", " + o.n + " coloring pages, printed and mailed"],
    ["shipping_address_collection[allowed_countries][0]", "US"], ["phone_number_collection[enabled]", "true"], ["billing_address_collection", "auto"],
    ["shipping_options[0][shipping_rate_data][type]", "fixed_amount"], ["shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0"], ["shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd"],
    ["shipping_options[0][shipping_rate_data][display_name]", "Standard shipping (free), " + SHIP.std.eta],
    ["shipping_options[1][shipping_rate_data][type]", "fixed_amount"], ["shipping_options[1][shipping_rate_data][fixed_amount][amount]", String(RUSH_PRICE)], ["shipping_options[1][shipping_rate_data][fixed_amount][currency]", "usd"],
    ["shipping_options[1][shipping_rate_data][display_name]", "Faster shipping, " + SHIP.rush.eta],
    ["custom_text[submit][message]", "We start drawing and printing your book as soon as you pay. Printed books are made to order, so we can't cancel once printing starts."]];
  const s = await stripe(env, "POST", "/checkout/sessions", pairs);
  if (!s || !s.url) return json({ error: "upstream", message: "Checkout didn't open. Please try again." }, 502);
  o.session = s.id; log(o, "checkout " + s.id.slice(0, 14)); await oPut(env, o);
  await activeSet(env, o.id, true); // so the cron notices a payment even if the visitor never comes back
  return json({ url: s.url });
}
async function confirmPaid(env, o) {
  if (!o || o.status !== "draft" || !o.session) return o;
  const s = await stripe(env, "GET", "/checkout/sessions/" + o.session);
  if (!s) return o;
  if (s.payment_status !== "paid") { if (s.status === "expired") { o.session = ""; await oPut(env, o); } return o; }
  const sd = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {}, a = sd.address || {}, cd = s.customer_details || {};
  o.pay = { email: cd.email || "", name: sd.name || cd.name || "", phone: cd.phone || "", amount: s.amount_total, pi: s.payment_intent,
    ship: { name: sd.name || cd.name || "", street1: a.line1 || "", street2: a.line2 || "", city: a.city || "", state: a.state || "", postcode: a.postal_code || "", country: a.country || "US" } };
  o.ship = s.shipping_cost && s.shipping_cost.amount_total > 0 ? "rush" : "std";
  o.status = "paid"; o.paidAt = Date.now(); o.pages = 4 + 2 * o.n; if (o.pages < 32) o.pages = 32;
  // Re-save everything without the draft's 3-day expiry.
  for (const n of Object.keys(o.have).concat(o.product === "picked" ? ["c"].concat([...Array(o.n)].map((_, i) => String(i + 1))) : [])) {
    const v = await iGet(env, o.id, n); if (v) await env.KV.put(iKey(o.id, n), v, { expirationTtl: 200 * DAY, metadata: { type: "image/jpeg" } });
    o.have[n] = v ? 1 : o.have[n];
  }
  log(o, "paid " + money(o.pay.amount) + " " + o.ship);
  await send(env, o, "confirm");
  await oPut(env, o); await activeSet(env, o.id, true);
  return o;
}
async function orderStatus(env, u) {
  let o = await owned(env, u.searchParams.get("id"), u.searchParams.get("tok"));
  if (!o) return json({ error: "gone" }, 404);
  if (o.status === "draft" && o.session) o = await confirmPaid(env, o);
  const drawn = Object.keys(o.have || {}).filter((k) => k !== "c").length;
  return json({ id: o.id, status: o.status, product: o.product, title: o.title, dedication: o.dedication || "", n: o.n, drawn, have: Object.keys(o.have || {}),
    captions: (o.scenes || []).map((s) => s.caption), ship: o.ship || "", tracking: o.lulu && o.lulu.url ? o.lulu.url : "", redrawsLeft: Math.max(0, 3 - (o.redraws || 0)) });
}

// ---------- Lulu ----------
async function luluToken(env) {
  const c = await env.KV.get("lulu:tok"); if (c) return c;
  const r = await fetch("https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token", { method: "POST", headers: { authorization: "Basic " + btoa(env.LULU_CLIENT_KEY + ":" + env.LULU_CLIENT_SECRET), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!r.ok) throw new Error("lulu token " + r.status);
  const j = await r.json(); await env.KV.put("lulu:tok", j.access_token, { expirationTtl: Math.max(60, (j.expires_in || 3600) - 120) });
  return j.access_token;
}
async function lulu(env, method, path, body) {
  const r = await fetch("https://api.lulu.com" + path, { method, headers: { authorization: "Bearer " + (await luluToken(env)), "content-type": "application/json", "cache-control": "no-cache" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) console.log("lulu", method, path, r.status, t.slice(0, 400));
  return { ok: r.ok, status: r.status, j, t };
}
async function luluSubmit(env, o, tag) {
  if (!o.coverPt) {
    const d = await lulu(env, "POST", "/cover-dimensions/", { pod_package_id: POD, interior_page_count: o.pages, unit: "pt" });
    if (!d.ok) return { ok: false, why: "cover-dimensions " + d.status + " " + d.t.slice(0, 200) };
    o.coverPt = [parseFloat(d.j.width), parseFloat(d.j.height)];
  }
  const base = "https://" + HOME + "/api/print/" + o.id + "/" + o.ptok + "/";
  const s = o.pay.ship;
  const r = await lulu(env, "POST", "/print-jobs/", {
    contact_email: "hello@makeacoloringbook.com", external_id: o.id + (tag ? "-" + tag : ""), production_delay: 60, shipping_level: SHIP[o.ship].lulu,
    shipping_address: { name: s.name, street1: s.street1, street2: s.street2 || undefined, city: s.city, state_code: s.state, postcode: s.postcode, country_code: s.country || "US", phone_number: o.pay.phone || "2094171892", email: "hello@makeacoloringbook.com" },
    line_items: [{ external_id: o.id, title: o.title, quantity: 1, printable_normalization: { pod_package_id: POD, cover: { source_url: base + "cover.pdf" }, interior: { source_url: base + "interior.pdf" } } }],
  });
  if (!r.ok) return { ok: false, why: "print-jobs " + r.status + " " + r.t.slice(0, 300) };
  return { ok: true, job: r.j.id };
}

// ---------- PDF (hand-built: JPEG pages, Fredoka text) ----------
const FW = [235,248,399,697,442,779,696,193,357,357,468,490,223,403,220,489,565,379,566,565,551,493,521,522,541,521,221,220,583,445,583,476,844,711,609,631,655,603,613,719,650,239,531,597,569,809,670,721,595,782,604,542,640,675,728,947,689,638,598,324,491,324,489,768,448,557,554,503,554,535,419,546,563,251,234,512,311,791,566,558,541,543,432,457,429,568,577,737,538,576,545,354,202,354,556,476,569,476,223,476,448,803,476,476,561,476,476,356,1016,476,476,476,476,220,220,448,448,318,542,665,543,781,476,360,878,476,476,476,235,249,404,628,630,630,200,521,526,661,414,654,489,476,661,600,379,466,423,425,563,559,571,220,328,299,408,651,731,748,748,475,711,711,711,711,711,711,1068,631,603,603,603,603,239,239,239,239,752,670,721,721,721,721,721,485,742,675,675,675,675,638,606,589,557,557,557,557,557,557,846,487,535,535,535,535,237,237,237,237,564,566,558,558,558,558,558,468,558,568,568,568,568,576,539,576];
const CP = { 8364: 128, 8218: 130, 8222: 132, 8230: 133, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 8482: 153 };
const winAnsi = (s) => [...String(s)].map((ch) => { const c = ch.codePointAt(0); return c >= 32 && c < 127 ? c : c >= 160 && c <= 255 ? c : CP[c] || 63; });
const textW = (s, size) => winAnsi(s).reduce((a, c) => a + FW[c - 32], 0) * size / 1000;
const pdfStr = (s) => "(" + winAnsi(s).map((c) => (c === 40 || c === 41 || c === 92 ? "\\" + String.fromCharCode(c) : c > 126 ? "\\" + c.toString(8).padStart(3, "0") : String.fromCharCode(c))).join("") + ")";
function wrap(s, size, maxW) {
  const words = String(s).split(/\s+/), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (textW(t, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines;
}
function fitText(s, maxW, start, min, maxLines) {
  for (let size = start; size >= min; size -= 2) { const l = wrap(s, size, maxW); if (l.length <= maxLines && l.every((x) => textW(x, size) <= maxW)) return { size, lines: l }; }
  return { size: min, lines: wrap(s, min, maxW).slice(0, maxLines) };
}
function centered(lines, size, cx, topY, gap) { return lines.map((l, i) => "BT /F1 " + size + " Tf " + (cx - textW(l, size) / 2).toFixed(2) + " " + (topY - i * size * (gap || 1.15)).toFixed(2) + " Td " + pdfStr(l) + " Tj ET").join("\n"); }
function jpegInfo(buf) {
  const u = new Uint8Array(buf); let i = 2;
  while (i < u.length) {
    if (u[i] !== 0xff) { i++; continue; }
    const m = u[i + 1], len = (u[i + 2] << 8) | u[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (u[i + 5] << 8) | u[i + 6], w: (u[i + 7] << 8) | u[i + 8], c: u[i + 9] };
    i += 2 + len;
  }
  return null;
}
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(3)).join(" "); }
class Pdf {
  constructor() { this.parts = []; this.len = 0; this.offs = [0]; this.n = 0; this.add("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"); }
  add(x) { const u = typeof x === "string" ? Uint8Array.from(x, (c) => c.charCodeAt(0) & 255) : x instanceof Uint8Array ? x : new Uint8Array(x); this.parts.push(u); this.len += u.length; }
  next() { return ++this.n; }
  obj(n, dict, stream) {
    this.offs[n] = this.len;
    if (stream === undefined) { this.add(n + " 0 obj\n" + dict + "\nendobj\n"); return; }
    const s = typeof stream === "string" ? Uint8Array.from(stream, (c) => c.charCodeAt(0) & 255) : new Uint8Array(stream);
    this.add(n + " 0 obj\n" + dict.replace(/>>\s*$/, " /Length " + s.length + " >>") + "\nstream\n"); this.add(s); this.add("\nendstream\nendobj\n");
  }
  finish(root) {
    const x = this.len; let t = "xref\n0 " + (this.n + 1) + "\n0000000000 65535 f \n";
    for (let i = 1; i <= this.n; i++) t += String(this.offs[i] || 0).padStart(10, "0") + " 00000 n \n";
    this.add(t + "trailer\n<< /Size " + (this.n + 1) + " /Root " + root + " 0 R >>\nstartxref\n" + x + "\n%%EOF\n");
    return new Blob(this.parts, { type: "application/pdf" });
  }
}
async function fontObjs(pdf) {
  const r = await fetch(SRC + "/fonts/fredoka-700.ttf", { cf: { cacheTtl: 86400 } }); if (!r.ok) throw new Error("font");
  const ttf = await r.arrayBuffer(), ff = pdf.next(), fd = pdf.next(), f = pdf.next();
  pdf.obj(ff, "<< /Length1 " + ttf.byteLength + " >>", ttf);
  pdf.obj(fd, "<< /Type /FontDescriptor /FontName /Fredoka-Bold /Flags 32 /FontBBox [-132 -236 1109 998] /ItalicAngle 0 /Ascent 974 /Descent -236 /CapHeight 700 /StemV 120 /FontFile2 " + ff + " 0 R >>");
  pdf.obj(f, "<< /Type /Font /Subtype /TrueType /BaseFont /Fredoka-Bold /FirstChar 32 /LastChar 255 /Widths [" + FW.join(" ") + "] /Encoding /WinAnsiEncoding /FontDescriptor " + fd + " 0 R >>");
  return f;
}
function imgObj(pdf, buf) {
  const info = jpegInfo(buf); if (!info) throw new Error("bad jpeg");
  const n = pdf.next();
  pdf.obj(n, "<< /Type /XObject /Subtype /Image /Width " + info.w + " /Height " + info.h + " /ColorSpace /" + (info.c === 1 ? "DeviceGray" : info.c === 4 ? "DeviceCMYK" : "DeviceRGB") + " /BitsPerComponent 8 /Filter /DCTDecode >>", buf);
  return { n, w: info.w, h: info.h };
}
async function interiorPdf(env, o) {
  const W = 612, H = 792, pdf = new Pdf(), cat = pdf.next(), pages = pdf.next(), font = await fontObjs(pdf), kids = [];
  const imgs = await Promise.all([...Array(o.n)].map((_, i) => iGet(env, o.id, i + 1)));
  if (imgs.some((x) => !x)) throw new Error("missing page");
  const page = (content, xobjs) => {
    const c = pdf.next(), p = pdf.next();
    pdf.obj(c, "<< >>", content);
    pdf.obj(p, "<< /Type /Page /Parent " + pages + " 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /Font << /F1 " + font + " 0 R >>" + (xobjs ? " /XObject << " + xobjs + " >>" : "") + " >> /Contents " + c + " 0 R >>");
    kids.push(p);
  };
  const ink = rgb("#1D1B2F") + " rg ";
  // 1 title, 2 blank, 3 belongs-to, 4 blank
  const t = fitText(o.title, W - 144, 40, 22, 3);
  page(ink + centered(t.lines, t.size, W / 2, 520) + (o.dedication ? "\n" + (() => { const d = fitText(o.dedication, W - 160, 20, 12, 2); return centered(d.lines, d.size, W / 2, 520 - t.lines.length * t.size * 1.15 - 30); })() : "") +
    "\n" + rgb("#77738F") + " rg " + centered(["makeacoloringbook.com"], 10, W / 2, 60));
  page("");
  const who = o.product === "kid" || o.product === "joke" ? o.form.name : "";
  page(ink + centered(["This book belongs to"], 26, W / 2, 470) + "\n" + rgb("#1D1B2F") + " RG 2 w 126 380 m 486 380 l S" + (who ? "\n" + ink + centered([who], fitText(who, 340, 34, 16, 1).size, W / 2, 392) : ""));
  page("");
  for (let i = 0; i < o.n; i++) {
    const im = imgObj(pdf, imgs[i]);
    let bx, by, bw, bh;
    if (o.product === "picked") { bx = 18; by = 0; bw = W - 36; bh = H; } // the browser's page already has margins; inset to Lulu's 0.5 in safety else { bx = 54; by = 36; bw = W - 54 - 36; bh = H - 72; }
    const s = Math.min(bw / im.w, bh / im.h), w = im.w * s, h = im.h * s, x = bx + (bw - w) / 2, y = by + (bh - h) / 2;
    page("q " + w.toFixed(2) + " 0 0 " + h.toFixed(2) + " " + x.toFixed(2) + " " + y.toFixed(2) + " cm /Im" + i + " Do Q", "/Im" + i + " " + im.n + " 0 R");
    page(""); // blank back so markers don't bleed through
  }
  while (kids.length < o.pages) page("");
  pdf.obj(pages, "<< /Type /Pages /Kids [" + kids.map((k) => k + " 0 R").join(" ") + "] /Count " + kids.length + " >>");
  pdf.obj(cat, "<< /Type /Catalog /Pages " + pages + " 0 R >>");
  return pdf.finish(cat);
}
async function coverPdf(env, o) {
  const [W, H] = o.coverPt, pdf = new Pdf(), cat = pdf.next(), pages = pdf.next(), font = await fontObjs(pdf);
  const bleed = 9, trimW = 612, frontX = W - (trimW + bleed), spine = W - 2 * (trimW + bleed);
  const art = await iGet(env, o.id, "c"); if (!art) throw new Error("no cover art");
  const im = imgObj(pdf, art);
  // Front: art fills the front panel (cropped to fit), title in a white box near the top (generated books).
  const fw = trimW + bleed, s = Math.max(fw / im.w, H / im.h), w = im.w * s, h = im.h * s, x = frontX + (fw - w) / 2, y = (H - h) / 2;
  let c = rgb("#FFF6E5") + " rg 0 0 " + (frontX + 1).toFixed(2) + " " + H.toFixed(2) + " re f\n";
  c += "q " + frontX.toFixed(2) + " 0 " + fw.toFixed(2) + " " + H.toFixed(2) + " re W n " + w.toFixed(2) + " 0 0 " + h.toFixed(2) + " " + x.toFixed(2) + " " + y.toFixed(2) + " cm /Im0 Do Q\n";
  const cx = frontX + trimW / 2;
  if (o.product !== "picked") {
    const t = fitText(o.title, trimW - 150, 46, 24, 2), boxH = t.lines.length * t.size * 1.15 + 40, top = H - bleed - 54;
    c += "1 1 1 rg " + rgb("#1D1B2F") + " RG 4 w " + (frontX + 54).toFixed(2) + " " + (top - boxH).toFixed(2) + " " + (trimW - 108).toFixed(2) + " " + boxH.toFixed(2) + " re B\n";
    c += rgb("#1D1B2F") + " rg " + centered(t.lines, t.size, cx, top - 20 - t.size * 0.8) + "\n";
  }
  // Back
  const bx = (trimW + bleed) / 2 + bleed / 2, ded = o.dedication || (o.product === "picked" ? "Pages picked just for you" : "");
  c += rgb("#1D1B2F") + " rg " + centered(fitText(o.title, trimW - 160, 24, 14, 2).lines, 22, bx, H * 0.62) + "\n";
  if (ded) c += rgb("#3B3852") + " rg " + centered(fitText(ded, trimW - 180, 16, 11, 2).lines, 15, bx, H * 0.62 - 60) + "\n";
  c += rgb("#77738F") + " rg " + centered(["Made to order by makeacoloringbook.com"], 11, bx, 90) + "\n";
  const cc = pdf.next(), p = pdf.next();
  pdf.obj(cc, "<< >>", c);
  pdf.obj(p, "<< /Type /Page /Parent " + pages + " 0 R /MediaBox [0 0 " + W.toFixed(2) + " " + H.toFixed(2) + "] /Resources << /Font << /F1 " + font + " 0 R >> /XObject << /Im0 " + im.n + " 0 R >> >> /Contents " + cc + " 0 R >>");
  pdf.obj(pages, "<< /Type /Pages /Kids [" + p + " 0 R] /Count 1 >>");
  pdf.obj(cat, "<< /Type /Catalog /Pages " + pages + " 0 R >>");
  return pdf.finish(cat);
}
async function printFile(env, u) {
  const m = /^\/api\/print\/(MCB-[A-Z2-9]{6})\/([a-f0-9]{32})\/(interior|cover)\.pdf$/.exec(u.pathname); if (!m) return new Response("no", { status: 404 });
  const o = await oGet(env, m[1]); if (!o || !same(o.ptok, m[2]) || o.status === "draft") return new Response("no", { status: 404 });
  if (m[3] === "cover" && !o.coverPt) return new Response("no", { status: 404 });
  const blob = m[3] === "interior" ? await interiorPdf(env, o) : await coverPdf(env, o);
  return new Response(blob, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

// ---------- the order machine (cron, every minute) ----------
async function advance(env, o) {
  const P = PRODUCTS[o.product];
  if (o.status === "draft") { if (o.session) await confirmPaid(env, o); if (o.status === "draft" && Date.now() - o.created > 2 * DAY * 1000) return "drop"; return o.status === "draft" ? "wait" : "save"; }
  if (o.status === "paid" || o.status === "drawing") {
    const missing = [];
    if (P.gen) { if (!o.have.c) missing.push("c"); for (let n = 1; n <= o.n; n++) if (!o.have[n]) missing.push(n); }
    if (missing.length) {
      o.status = "drawing";
      if (missing[0] !== "c" && !o.have[1] && missing.indexOf(1) >= 0) missing.splice(0, missing.length, 1); // page 1 first: the others copy its character
      const batch = missing.slice(0, num(env.PAGES_PER_RUN, 3));
      const res = await Promise.all(batch.map((n) => drawPage(env, o, n).then((d) => [n, d])));
      for (const [n, d] of res) if (!d.ok && !/^429/.test(d.why || "")) {
        o.fails = o.fails || {}; o.fails[n] = (o.fails[n] || 0) + 1; log(o, "page " + n + " failed: " + (d.why || ""));
        if (d.blocked && n !== "c" && o.fails[n] >= 2) { o.scenes[n - 1] = { caption: o.scenes[n - 1].caption, scene: "The main character smiling and waving in a sunny park with trees, flowers and a few birds." }; }
        if (o.fails[n] === 6) await alertNate(env, o, "a page keeps failing to draw", "Page " + n + " failed 6 times: " + (d.why || "") + "\nOften this means the OpenAI balance is used up.");
      }
      return "save";
    }
    o.status = "ready"; log(o, "all pages drawn"); return "save";
  }
  if (o.status === "ready") {
    const r = await luluSubmit(env, o);
    if (!r.ok) { o.luluFails = (o.luluFails || 0) + 1; log(o, "lulu submit failed: " + r.why); if (o.luluFails === 3) await alertNate(env, o, "Lulu won't take the print job", r.why); return "save"; }
    o.lulu = { job: r.job, status: "CREATED", checked: Date.now() }; o.status = "printing"; log(o, "lulu job " + r.job); return "save";
  }
  if (o.status === "printing" || o.status === "reprint") {
    const L = o.lulu; if (Date.now() - (L.checked || 0) < 20 * 60 * 1000) return "wait";
    const r = await lulu(env, "GET", "/print-jobs/" + L.job + "/"); L.checked = Date.now();
    if (!r.ok) return "save";
    const st = (r.j.status && r.j.status.name) || "", li = (r.j.line_items || [])[0] || {}, msg = (li.status && li.status.messages) || {};
    if (st !== L.status) { log(o, "lulu " + st); L.status = st; L.since = Date.now(); }
    if (st === "SHIPPED") {
      L.tracking = li.tracking_id || msg.tracking_id || ""; L.url = (li.tracking_urls || msg.tracking_urls || [])[0] || ""; L.carrier = li.carrier_name || msg.carrier_name || "";
      L.shippedAt = Date.now(); o.status = "shipped"; await send(env, o, "shipped"); return "done";
    }
    if (st === "REJECTED" || st === "ERROR" || st === "CANCELED") { o.status = "problem"; await alertNate(env, o, "Lulu print job " + st, JSON.stringify(r.j.status || {}).slice(0, 800)); return "done"; }
    if ((st === "UNPAID" || st === "CREATED") && Date.now() - (L.since || Date.now()) > 3 * 3600 * 1000 && !L.warned) { L.warned = 1; await alertNate(env, o, "Lulu job stuck " + st, "Lulu hasn't charged for this job in 3 hours. Usually the card on Lulu's API payment page is missing or declined."); }
    return "save";
  }
  return "done";
}
async function cron(env) {
  if (!env.STRIPE_SECRET) return;
  const lock = await env.KV.get("lock:cron"); if (lock && Date.now() - +lock < 55000) return;
  await env.KV.put("lock:cron", String(Date.now()), { expirationTtl: 60 });
  const ids = await activeGet(env); let drew = 0;
  for (const id of ids) {
    const o = await oGet(env, id); if (!o) { await activeSet(env, id, false); continue; }
    if ((o.status === "paid" || o.status === "drawing") && drew >= num(env.ORDERS_PER_RUN, 1)) continue;
    if (o.status === "paid" || o.status === "drawing") drew++;
    let r; try { r = await advance(env, o); } catch (e) { log(o, "error " + String(e).slice(0, 120)); r = "save"; }
    if (r === "drop") { await activeSet(env, id, false); continue; }
    if (r !== "wait") await oPut(env, o);
    if (r === "done") await activeSet(env, id, false);
  }
}

// ---------- problems: the fixed policy ----------
const ESCALATE = /\b(chargeback|dispute|lawyer|attorney|sue|suing|court|fraud|scam|bbb|police|report you|furious|unacceptable|ripped off)\b/i;
async function orderHelp(q, env) {
  if (!okOrigin(q)) return json({ error: "origin" }, 403);
  let b; try { b = await q.json(); } catch (e) { return json({ error: "bad" }, 400); }
  if (!(await human(q, env, b.ts))) return json({ error: "human", message: "We could not confirm you are a person. Please try again." }, 403);
  const id = String(b.order || "").trim().toUpperCase(), email = String(b.email || "").trim().toLowerCase(), kind = String(b.kind || ""), note = clip(b.note, 1000);
  const o = await oGet(env, id);
  if (!o || !o.pay || o.pay.email.toLowerCase() !== email) return json({ error: "nomatch", message: "We couldn't find an order with that number and email. Check the confirmation email, or write to hello@makeacoloringbook.com." }, 404);
  const reply = (auto, message) => json({ ok: true, auto, message });
  const toNate = async (why) => { o.problem = Object.assign(o.problem || {}, { open: true, kind, note, at: Date.now() }); await alertNate(env, o, why, "Customer wrote (" + kind + "): " + note); await oPut(env, o); return reply(false, "Thanks for telling us. We'll look at this ourselves and email you within 2 business days."); };
  if (ESCALATE.test(note)) return toNate("customer message needs a personal reply");
  if (o.problem && o.problem.used) return toNate("second problem on the same order");
  if (["misprint", "damaged", "lost"].indexOf(kind) < 0) return toNate("problem outside the policy");
  if (o.status !== "shipped") return reply(false, o.status === "printing" || o.status === "drawing" || o.status === "paid" || o.status === "ready" ? "Your book hasn't shipped yet. We'll email the tracking link as soon as it does." : "We'll look at this ourselves and email you within 2 business days.");
  const due = o.lulu.shippedAt + SHIP[o.ship].lostDays * DAY * 1000;
  if (kind === "lost" && Date.now() < due) return reply(false, "Your book is still within its normal delivery time. If it hasn't arrived by " + new Date(due).toLocaleDateString("en-US", { month: "long", day: "numeric" }) + ", come back to this page and we'll send a new one or refund you.");
  o.problem = { used: true, kind, note, at: Date.now() };
  if (kind === "lost" && b.choice === "refund") {
    const rf = await stripe(env, "POST", "/refunds", [["payment_intent", o.pay.pi], ["amount", String(o.pay.amount)], ["metadata[order]", o.id], ["reason", "requested_by_customer"]]);
    if (!rf) { o.problem.used = false; return toNate("automatic refund failed"); }
    o.problem.refunded = o.pay.amount; o.status = "refunded"; log(o, "refunded " + money(o.pay.amount)); await send(env, o, "refund"); await oPut(env, o);
    return reply(true, "Done. We've refunded " + money(o.pay.amount) + " to your card. You'll get an email confirming it.");
  }
  const r = await luluSubmit(env, o, "R");
  if (!r.ok) { o.problem.used = false; return toNate("automatic reprint failed: " + r.why); }
  o.lulu = { job: r.job, status: "CREATED", checked: Date.now(), first: o.lulu }; o.status = "reprint"; log(o, "reprint job " + r.job + " (" + kind + ")");
  await send(env, o, "reprint"); await oPut(env, o); await activeSet(env, o.id, true);
  return reply(true, "Done. We're printing a new copy at no charge and sending it to the same address. You'll get an email now and another with tracking when it ships.");
}

// ---------- admin (team key): order list for Nate, Dave and Claude ----------
async function adminOrders(q, env, u) {
  if (!(await teamOk(q, env, u.searchParams.get("k")))) return json({ error: "key" }, 403);
  const ids = await activeGet(env), extra = (u.searchParams.get("ids") || "").split(",").filter((x) => OID.test(x));
  const out = [];
  for (const id of ids.concat(extra)) { const o = await oGet(env, id); if (o) out.push({ id, product: o.product, status: o.status, title: o.title, n: o.n, have: Object.keys(o.have || {}).length, ship: o.ship, amount: o.pay && o.pay.amount, city: o.pay && o.pay.ship.city, lulu: o.lulu && { job: o.lulu.job, status: o.lulu.status }, needsNate: o.needsNate || "", log: (o.log || []).slice(-8) }); }
  return json({ active: ids.length, orders: out });
}

async function orders(q, env, u, ctx) {
  const p = u.pathname;
  if (p === "/api/order/draft" && q.method === "POST") return orderDraft(q, env);
  if (p === "/api/order/upload" && q.method === "PUT") return orderUpload(q, env, u);
  if (p === "/api/order/preview" && q.method === "POST") return orderPreview(q, env);
  if (p.startsWith("/api/order/img/")) return orderImg(env, u);
  if (p === "/api/order/checkout" && q.method === "POST") return orderCheckout(q, env);
  if (p === "/api/order/status") return orderStatus(env, u);
  if (p === "/api/order/help" && q.method === "POST") return orderHelp(q, env);
  if (p === "/api/order/open") return json({ open: await ordersOpen(q, env), prices: Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, v.price])), rush: RUSH_PRICE, ts: env.TURNSTILE_SECRET ? TS_SITEKEY : "" });
  if (p.startsWith("/api/print/")) return printFile(env, u);
  if (p.startsWith("/api/mail/")) return mailbox(q, env, u);
  if (p === "/api/admin/orders") return adminOrders(q, env, u);
  if (p === "/api/admin/test-mail" && q.method === "POST") {
    if (!(await teamOk(q, env))) return json({ error: "key" }, 403);
    await mail(env, "hello@makeacoloringbook.com", "Mailer test", "This is a test from the website's order mailer. If you're reading it in the hello@ inbox, order emails will go out.");
    return json({ ok: true });
  }
  if (p === "/api/admin/lulu-check") {
    if (!(await teamOk(q, env))) return json({ error: "key" }, 403);
    const pages = num(u.searchParams.get("pages"), 52);
    const dims = await lulu(env, "POST", "/cover-dimensions/", { pod_package_id: POD, interior_page_count: pages, unit: "pt" });
    const cost = await lulu(env, "POST", "/print-job-cost-calculations/", { line_items: [{ page_count: pages, pod_package_id: POD, quantity: 1 }], shipping_address: { city: "Hughson", country_code: "US", postcode: "95326", state_code: "CA", street1: "PO Box 387", phone_number: "2094171892" }, shipping_option: u.searchParams.get("ship") || "MAIL" });
    return json({ dims: dims.j || dims.t.slice(0, 300), cost: cost.ok ? { total: cost.j.total_cost_incl_tax, lines: (cost.j.line_item_costs || []).map((x) => x.total_cost_incl_tax), ship: cost.j.shipping_cost && cost.j.shipping_cost.total_cost_incl_tax } : cost.t.slice(0, 400) });
  }
  return json({ error: "nope" }, 404);
}

export default {
  async fetch(q, env, ctx) {
    const u = new URL(q.url);
    if (u.hostname !== HOME && !u.hostname.endsWith(".workers.dev")) {
      u.hostname = HOME; u.protocol = "https:";
      return Response.redirect(u.toString(), 301);
    }
    if (u.pathname === "/api/make/status") return status(q, env || {});
    if (u.pathname === "/api/hearts") return heartsAll(q, env, ctx);
    if (u.pathname === "/api/heart") return q.method === "POST" ? heart(q, env) : json({ error: "method" }, 405);
    if (/^\/api\/(order|print|mail|admin)\//.test(u.pathname)) { try { return await orders(q, env, u, ctx); } catch (e) { console.log("orders failed", String(e), e && e.stack); return json({ error: "server", message: "Something went wrong. Please try again." }, 500); } }
    if (u.pathname.startsWith("/api/team/")) { try { return await team(q, env, u, ctx); } catch (e) { console.log("team failed", String(e)); return json({ error: "server", message: "Something went wrong: " + String(e).slice(0, 120) }, 500); } }
    if (u.pathname === "/api/make") {
      if (q.method !== "POST") return json({ error: "method" }, 405);
      try { return await make(q, env || {}); } catch (e) { console.log("make failed", String(e)); return json({ error: "server", message: "Something went wrong. Please try again." }, 500); }
    }
    const o = new URL(SRC + u.pathname + u.search);
    const r = await fetch(o, { method: q.method, headers: { "user-agent": q.headers.get("user-agent") || "cf" }, redirect: "manual" });
    const h = new Headers(r.headers);
    const l = h.get("location");
    if (l) h.set("location", l.replace("https://popcornlove.net", "").replace("/free-coloring-pages", ""));
    return new Response(r.body, { status: r.status, headers: h });
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(cron(env).catch((e) => console.log("cron failed", String(e)))); },
};
