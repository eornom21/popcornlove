// Cloudflare Worker "makeacoloringbook".
// 1. Serves the site from popcornlove.net/free-coloring-pages at makeacoloringbook.com.
// 2. Forwards every other attached host to makeacoloringbook.com.
// 3. /api/make: draws a coloring page on the spot from a typed idea (OpenAI image API).
// 4. /api/hearts, /api/heart: public heart counts for each page (KV "heart:<id>", count kept in key metadata).
// 5. /api/team/*: Uncle Dave's team tools (key checked against TEAM_KEY_HASH): draw without the visitor limits, publish to the site.
//    A GitHub Action (team-pages) pulls /api/team/queue every few minutes and adds published pages to the site.
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
      f.append("output_format", fmt); f.append("n", "1"); f.append("moderation", "auto");
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
};
