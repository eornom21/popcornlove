// Vancouver trip app: one shared copy of the family's checkmarks, restaurant picks, treat scores
// and "where we are" notes, so a tap on one phone shows up on the others.
//
// Deployed as the Cloudflare Worker `vancouver-trip` (https://vancouver-trip.natemonroe21.workers.dev)
// with one KV binding named KV. To change it: paste this file into the Worker's dashboard editor,
// put the real hash back in CODE_SHA256, and deploy.
//
// The family code is not stored anywhere in this file or in KV. The deployed copy holds only the
// code's SHA-256. This repo copy keeps a placeholder on purpose, because the repo is public.
const CODE_SHA256 = 'SET_IN_THE_DEPLOYED_WORKER_ONLY';

const ORIGINS = ['https://popcornlove.net'];
const MAX_BODY = 60000;      // bytes of JSON a phone may send
const MAX_KEYS = 800;        // entries in the shared copy
const MAX_KEY = 90;          // characters in one entry's name
const MAX_VAL = 400;         // characters in one entry's value, as JSON
const NOTE_LIFE = 36 * 3600 * 1000; // "where we are" notes expire after 36 hours
const SKEW = 5 * 60 * 1000;  // a phone's clock may run this far ahead

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function reply(req, obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors(req))
  });
}
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}
// Spaces, dashes and capitals in the typed code don't matter.
function norm(code) { return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// An entry is [value, time]. The newer one wins; on a tie the larger JSON wins, so every phone agrees.
function beats(a, b) {
  if (!b) return true;
  if (a[1] !== b[1]) return a[1] > b[1];
  return JSON.stringify(a[0]) > JSON.stringify(b[0]);
}
function okEntry(k, e, now) {
  if (typeof k !== 'string' || !k || k.length > MAX_KEY || /[\u0000-\u001f]/.test(k)) return false;
  if (!Array.isArray(e) || e.length !== 2 || typeof e[1] !== 'number' || !isFinite(e[1]) || e[1] < 0) return false;
  const v = e[0], t = typeof v;
  if (!(v === null || t === 'boolean' || t === 'number' || t === 'string' || (t === 'object' && !Array.isArray(v)))) return false;
  if (JSON.stringify(v).length > MAX_VAL) return false;
  if (k.slice(0, 2) === 's:' && e[1] < now - NOTE_LIFE) return false;
  return true;
}
export function merge(stored, incoming, now) {
  const out = {};
  let changed = false;
  for (const k in stored) {
    if (k.slice(0, 2) === 's:' && stored[k][1] < now - NOTE_LIFE) { changed = true; continue; }
    out[k] = stored[k];
  }
  let n = Object.keys(out).length;
  for (const k in incoming) {
    const e = incoming[k];
    if (!okEntry(k, e, now)) continue;
    const entry = [e[0], e[1] > now + SKEW ? now : Math.floor(e[1])];
    if (!(k in out)) { if (n >= MAX_KEYS) continue; n++; }
    if (beats(entry, out[k])) { out[k] = entry; changed = true; }
  }
  return { state: out, changed };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/sync') return reply(req, { error: 'not found' }, 404);
    const text = await req.text();
    if (text.length > MAX_BODY) return reply(req, { error: 'too big' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return reply(req, { error: 'bad request' }, 400); }
    if (!body || typeof body !== 'object') return reply(req, { error: 'bad request' }, 400);
    if ((await sha256(norm(body.code))) !== CODE_SHA256) return reply(req, { error: 'wrong code' }, 403);
    const incoming = body.state && typeof body.state === 'object' && !Array.isArray(body.state) ? body.state : {};
    const now = Date.now();
    const stored = (await env.KV.get('state', 'json')) || {};
    const m = merge(stored, incoming, now);
    if (m.changed) await env.KV.put('state', JSON.stringify(m.state));
    return reply(req, { state: m.state, now });
  }
};
