// Cloudflare Worker "makeacoloringbook".
// 1. Serves the site from popcornlove.net/free-coloring-pages at makeacoloringbook.com.
// 2. Forwards every other attached host to makeacoloringbook.com.
// 3. /api/make: draws a coloring page on the spot from a typed idea (OpenAI image API).
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
  if (c.mine >= c.limIp) return json({ error: "limit", message: "That is your " + c.limIp + " free instant pages for today. Come back tomorrow!" }, 429);
  if (c.all >= c.limDay) return json({ error: "busy", message: "Our crayons are worn out for today. Send it as a request and we'll draw it soon." }, 429);

  const auth = { authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" };
  // Text safety check first. If the check itself fails, we stop: this is a kids' site.
  let flagged = true;
  try {
    const m = await fetch("https://api.openai.com/v1/moderations", { method: "POST", headers: auth, body: JSON.stringify({ model: "omni-moderation-latest", input: idea }) });
    if (m.ok) { const j = await m.json(); flagged = !!(j.results && j.results[0] && j.results[0].flagged); }
    else if (m.status === 401 || m.status === 429) return json({ error: "upstream", message: "The drawing machine is resting. Please try again later." }, 503);
  } catch (e) { flagged = true; }
  if (flagged) return json({ error: "blocked", message: "We can't draw that one. Try a different idea." }, 400);

  // Count the attempt before drawing so a burst of clicks cannot run past the limits.
  const ttl = { expirationTtl: 172800 };
  await Promise.all([env.KV.put(c.ipKey, String(c.mine + 1), ttl), env.KV.put(c.dayKey, String(c.all + 1), ttl)]);

  const prompt = "Black and white coloring book page, portrait orientation. Subject: " + idea + ". " + STYLES[style] + " " + TAIL + " " + RULES;
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: auth,
    body: JSON.stringify({ model: env.IMAGE_MODEL || "gpt-image-2.6-flare", prompt, size: "1024x1536", quality: env.QUALITY || "medium", n: 1, output_format: "webp", output_compression: 92, background: "opaque", moderation: "auto", safety_identifier: c.ipKey.slice(-24) }),
  });
  if (!r.ok) {
    // Give the visitor their turn back; the site-wide count stays (it guards spending).
    await env.KV.put(c.ipKey, String(c.mine), ttl);
    let why = ""; try { const e = await r.json(); why = (e.error && (e.error.code || e.error.type)) || ""; } catch (e) {}
    if (r.status === 400 && /moderation|safety|content_policy/i.test(why)) return json({ error: "blocked", message: "We can't draw that one. Try a different idea." }, 400);
    console.log("image error", r.status, why);
    return json({ error: "upstream", message: "The drawing did not come out. Please try again in a minute." }, 502);
  }
  // Pass OpenAI's JSON straight through (the picture is in data[0].b64_json). No re-encoding here.
  return new Response(r.body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-left": String(Math.max(0, c.limIp - c.mine - 1)) } });
}

export default {
  async fetch(q, env) {
    const u = new URL(q.url);
    if (u.hostname !== HOME && !u.hostname.endsWith(".workers.dev")) {
      u.hostname = HOME; u.protocol = "https:";
      return Response.redirect(u.toString(), 301);
    }
    if (u.pathname === "/api/make/status") return status(q, env || {});
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
