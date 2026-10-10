import crypto from "node:crypto";
import { openStore } from "../lib/store.mjs";

export const config = { path: "/api/*" };

// Netlify Functions cap request/response bodies at ~6 MB (after base64), so
// movies are stored and served in 3 MB chunks.
const CHUNK = 3 * 1024 * 1024;
const MAX_FILE = 20 * 1024 * 1024 * 1024;
const MAX_PROFILES = 6;
const RATINGS = ["G", "PG", "PG-13", "R", "NR"];
const TOKEN_TTL = 30 * 24 * 3600;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// ---------- auth ----------
// ACCESS_PASSWORD (optional): needed to watch. ADMIN_PASSWORD: needed to upload/delete.
// With no ADMIN_PASSWORD, uploads are disabled entirely.
const env = (k) => process.env[k] || "";
const secret = () => env("AUTH_SECRET") || `${env("ADMIN_PASSWORD")}|${env("ACCESS_PASSWORD")}`;
const hmac = (s) => crypto.createHmac("sha256", secret()).update(s).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function makeToken(role) {
  const body = `${role}.${Math.floor(Date.now() / 1000) + TOKEN_TTL}`;
  return `${body}.${hmac(body)}`;
}

function verifyToken(token) {
  const [role, exp, sig] = String(token || "").split(".");
  if (!role || !exp || !sig) return null;
  if (!safeEqual(sig, hmac(`${role}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  if (role === "admin" && !env("ADMIN_PASSWORD")) return null;
  return role === "admin" || role === "viewer" ? role : null;
}

function roleOf(req, url) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("t");
  const role = token && verifyToken(token);
  if (role) return role;
  return env("ACCESS_PASSWORD") ? null : "viewer";
}

const requireAdmin = (role) => {
  if (role !== "admin") throw new HttpError(403, "Admin password required");
};

// ---------- helpers ----------
const app = () => openStore("app");
const media = () => openStore("media");
const newId = () => crypto.randomBytes(8).toString("hex");

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

const text = (v, max, fallback = "") => String(v ?? fallback).trim().slice(0, max);

const getProfiles = async () => (await app().get("profiles", { type: "json" })) || [];
const getIndex = async () => (await app().get("index", { type: "json" })) || [];

function cleanProfile(b, existing = {}) {
  const name = text(b.name ?? existing.name, 20);
  if (!name) throw new HttpError(400, "Name is required");
  const emoji = text(b.avatar?.emoji ?? existing.avatar?.emoji, 8, "🙂") || "🙂";
  const colorRaw = text(b.avatar?.color ?? existing.avatar?.color, 7, "#e50914");
  const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : "#e50914";
  return { ...existing, name, kids: Boolean(b.kids ?? existing.kids), avatar: { emoji, color } };
}

// ---------- router ----------
async function route(req) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  const method = req.method;

  if (a === "session" && method === "GET") {
    const role = roleOf(req, url);
    return json({
      role,
      needsLogin: Boolean(env("ACCESS_PASSWORD")),
      adminEnabled: Boolean(env("ADMIN_PASSWORD")),
      chunkSize: CHUNK,
    });
  }

  if (a === "login" && method === "POST") {
    const { password = "" } = await readBody(req);
    const admin = env("ADMIN_PASSWORD");
    const access = env("ACCESS_PASSWORD");
    if (admin && safeEqual(password, admin)) return json({ role: "admin", token: makeToken("admin") });
    if (access && safeEqual(password, access)) return json({ role: "viewer", token: makeToken("viewer") });
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(401, "Wrong password");
  }

  const role = roleOf(req, url);
  if (!role) throw new HttpError(401, "Login required");

  // ----- profiles -----
  if (a === "profiles") {
    if (!b) {
      if (method === "GET") return json(await getProfiles());
      if (method === "POST") {
        const profiles = await getProfiles();
        if (profiles.length >= MAX_PROFILES) throw new HttpError(400, `Up to ${MAX_PROFILES} profiles`);
        const profile = { id: newId(), list: [], ...cleanProfile(await readBody(req)) };
        profiles.push(profile);
        await app().setJSON("profiles", profiles);
        return json(profile, 201);
      }
    } else {
      const profiles = await getProfiles();
      const i = profiles.findIndex((p) => p.id === b);
      if (i < 0) throw new HttpError(404, "Profile not found");

      if (!c && method === "PUT") {
        profiles[i] = cleanProfile(await readBody(req), profiles[i]);
        await app().setJSON("profiles", profiles);
        return json(profiles[i]);
      }
      if (!c && method === "DELETE") {
        profiles.splice(i, 1);
        await app().setJSON("profiles", profiles);
        await app().delete(`progress/${b}`);
        return json({ ok: true });
      }
      if (c === "progress" && method === "GET") {
        return json((await app().get(`progress/${b}`, { type: "json" })) || {});
      }
      if (c === "progress" && method === "PUT") {
        const { movieId, t, d: dur } = await readBody(req);
        const progress = (await app().get(`progress/${b}`, { type: "json" })) || {};
        if (!t || t < 5 || (dur && t > dur * 0.95)) delete progress[movieId];
        else progress[text(movieId, 32)] = { t: Math.floor(t), d: Math.floor(dur || 0), at: Date.now() };
        await app().setJSON(`progress/${b}`, progress);
        return json({ ok: true });
      }
      if (c === "list" && method === "POST") {
        const { movieId, on } = await readBody(req);
        const set = new Set(profiles[i].list || []);
        on ? set.add(movieId) : set.delete(movieId);
        profiles[i].list = [...set];
        await app().setJSON("profiles", profiles);
        return json({ list: profiles[i].list });
      }
    }
  }

  // ----- movies -----
  if (a === "movies") {
    if (!b) {
      if (method === "GET") {
        const index = await getIndex();
        return json(role === "admin" ? index : index.filter((m) => m.status === "ready"));
      }
      if (method === "POST") {
        requireAdmin(role);
        const body = await readBody(req);
        const title = text(body.title, 120);
        const size = Number(body.size);
        if (!title) throw new HttpError(400, "Title is required");
        if (!(size > 0) || size > MAX_FILE) throw new HttpError(400, "Invalid file size");
        const movie = {
          id: newId(),
          title,
          year: Math.min(2100, Math.max(1880, parseInt(body.year, 10) || new Date().getFullYear())),
          genre: text(body.genre, 40, "Drama") || "Drama",
          rating: RATINGS.includes(body.rating) ? body.rating : "NR",
          description: text(body.description, 1000),
          duration: Math.max(0, Math.floor(Number(body.duration) || 0)),
          size,
          type: String(body.type || "").startsWith("video/") ? body.type : "video/mp4",
          chunks: Math.ceil(size / CHUNK),
          hasPoster: false,
          status: "uploading",
          addedAt: Date.now(),
        };
        const index = await getIndex();
        index.push(movie);
        await app().setJSON("index", index);
        return json({ ...movie, chunkSize: CHUNK }, 201);
      }
    } else {
      const index = await getIndex();
      const movie = index.find((m) => m.id === b);
      if (!movie) throw new HttpError(404, "Movie not found");
      if (movie.status !== "ready" && role !== "admin") throw new HttpError(404, "Movie not found");

      if (!c && method === "DELETE") {
        requireAdmin(role);
        const { blobs } = await media().list({ prefix: `data/${b}/` });
        await Promise.all(blobs.map((x) => media().delete(x.key)));
        await media().delete(`poster/${b}`);
        await app().setJSON("index", index.filter((m) => m.id !== b));
        return json({ ok: true });
      }

      if (c === "poster" && method === "PUT") {
        requireAdmin(role);
        const buf = await req.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > 1024 * 1024) throw new HttpError(400, "Poster must be under 1 MB");
        await media().set(`poster/${b}`, buf);
        movie.hasPoster = true;
        await app().setJSON("index", index);
        return json({ ok: true });
      }
      if (c === "poster" && method === "GET") {
        const buf = await media().get(`poster/${b}`, { type: "arrayBuffer" });
        if (!buf) throw new HttpError(404, "No poster");
        return new Response(buf, {
          headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" },
        });
      }

      if (c === "chunks" && !d && method === "GET") {
        requireAdmin(role);
        const { blobs } = await media().list({ prefix: `data/${b}/` });
        return json({ have: blobs.map((x) => Number(x.key.split("/").pop())) });
      }
      if (c === "chunks" && d !== undefined && method === "PUT") {
        requireAdmin(role);
        const n = Number(d);
        if (!Number.isInteger(n) || n < 0 || n >= movie.chunks) throw new HttpError(400, "Bad chunk number");
        const buf = await req.arrayBuffer();
        const expected = n === movie.chunks - 1 ? movie.size - n * CHUNK : CHUNK;
        if (buf.byteLength !== expected) throw new HttpError(400, `Chunk ${n} should be ${expected} bytes`);
        await media().set(`data/${b}/${n}`, buf);
        return json({ ok: true });
      }
      if (c === "complete" && method === "POST") {
        requireAdmin(role);
        const { blobs } = await media().list({ prefix: `data/${b}/` });
        if (blobs.length < movie.chunks) throw new HttpError(400, `Missing ${movie.chunks - blobs.length} chunks`);
        movie.status = "ready";
        await app().setJSON("index", index);
        return json(movie);
      }

      if (c === "stream" && (method === "GET" || method === "HEAD")) {
        if (movie.status !== "ready" && role !== "admin") throw new HttpError(404, "Movie not found");
        const size = movie.size;
        let start = 0;
        let end = size - 1;
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
        if (m) {
          if (m[1] === "" && m[2] !== "") start = Math.max(0, size - Number(m[2]));
          else if (m[1] !== "") {
            start = Number(m[1]);
            if (m[2] !== "") end = Math.min(end, Number(m[2]));
          }
        }
        if (start >= size || start > end) {
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        }
        // Never cross a chunk boundary: the browser simply asks for the next range.
        const n = Math.floor(start / CHUNK);
        end = Math.min(end, (n + 1) * CHUNK - 1);
        const headers = {
          "content-type": movie.type,
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": String(end - start + 1),
          "cache-control": "private, max-age=3600",
        };
        if (method === "HEAD") return new Response(null, { status: 206, headers });
        const buf = await media().get(`data/${b}/${n}`, { type: "arrayBuffer" });
        if (!buf) throw new HttpError(404, "Missing video data");
        return new Response(buf.slice(start - n * CHUNK, end - n * CHUNK + 1), { status: 206, headers });
      }
    }
  }

  throw new HttpError(404, "Not found");
}

export default async (req) => {
  try {
    return await route(req);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
};
