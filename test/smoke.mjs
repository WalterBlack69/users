import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "stream-"));
process.env.ADMIN_PASSWORD = "admin-pw";
process.env.ACCESS_PASSWORD = "family-pw";

const { default: handler } = await import("../netlify/functions/api.mjs");
const call = (method, p, { token, body, raw, headers = {} } = {}) =>
  handler(new Request(`http://x/api/${p}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  }));
const j = async (r) => r.json();

// auth
assert.equal((await call("GET", "profiles")).status, 401);
assert.equal((await call("POST", "login", { body: { password: "nope" } })).status, 401);
const viewer = (await j(await call("POST", "login", { body: { password: "family-pw" } }))).token;
const admin = (await j(await call("POST", "login", { body: { password: "admin-pw" } }))).token;
assert.equal((await call("GET", "profiles", { token: viewer })).status, 200);
assert.equal((await call("POST", "movies", { token: viewer, body: { title: "x", size: 5 } })).status, 403);

// profiles
const kid = await j(await call("POST", "profiles", { token: viewer, body: { name: "Kiddo", kids: true } }));
assert.equal(kid.kids, true);
assert.equal((await call("POST", "profiles", { token: viewer, body: { name: "" } })).status, 400);

// upload a ~7MB "movie" in chunks
const data = Buffer.alloc(7 * 1024 * 1024 + 123);
for (let i = 0; i < data.length; i++) data[i] = (i * 31) % 251;
const movie = await j(await call("POST", "movies", { token: admin, body: { title: "Test", size: data.length, type: "video/mp4", rating: "PG" } }));
const CH = movie.chunkSize;
assert.equal(movie.chunks, 3);
for (let n = 0; n < movie.chunks; n++) {
  const r = await call("PUT", `movies/${movie.id}/chunks/${n}`, { token: admin, raw: data.subarray(n * CH, (n + 1) * CH) });
  assert.equal(r.status, 200);
}
assert.equal((await call("PUT", `movies/${movie.id}/chunks/0`, { token: admin, raw: Buffer.alloc(10) })).status, 400);
assert.equal((await j(await call("GET", "movies", { token: viewer }))).length, 0, "hidden until complete");
assert.equal((await call("POST", `movies/${movie.id}/complete`, { token: admin })).status, 200);
assert.equal((await j(await call("GET", "movies", { token: viewer }))).length, 1);

// stream with ranges (across a chunk boundary)
const start = CH - 100;
const r = await call("GET", `movies/${movie.id}/stream`, { token: viewer, headers: { range: `bytes=${start}-` } });
assert.equal(r.status, 206);
const got = Buffer.from(await r.arrayBuffer());
assert.equal(got.length, 100);
assert.ok(got.equals(data.subarray(start, start + 100)));
const r2 = await call("GET", `movies/${movie.id}/stream`, { token: viewer, headers: { range: `bytes=${CH}-${CH + 9}` } });
assert.ok(Buffer.from(await r2.arrayBuffer()).equals(data.subarray(CH, CH + 10)));
const tail = await call("GET", `movies/${movie.id}/stream`, { token: viewer, headers: { range: "bytes=-50" } });
assert.ok(Buffer.from(await tail.arrayBuffer()).equals(data.subarray(data.length - 50)));
assert.equal((await call("GET", `movies/${movie.id}/stream`, { token: viewer, headers: { range: `bytes=${data.length}-` } })).status, 416);

// progress + my list
await call("PUT", `profiles/${kid.id}/progress`, { token: viewer, body: { movieId: movie.id, t: 100, d: 1000 } });
assert.equal((await j(await call("GET", `profiles/${kid.id}/progress`, { token: viewer })))[movie.id].t, 100);
await call("PUT", `profiles/${kid.id}/progress`, { token: viewer, body: { movieId: movie.id, t: 990, d: 1000 } });
assert.deepEqual(await j(await call("GET", `profiles/${kid.id}/progress`, { token: viewer })), {});
assert.deepEqual((await j(await call("POST", `profiles/${kid.id}/list`, { token: viewer, body: { movieId: movie.id, on: true } }))).list, [movie.id]);

// delete
assert.equal((await call("DELETE", `movies/${movie.id}`, { token: admin })).status, 200);
assert.equal((await j(await call("GET", "movies", { token: admin }))).length, 0);
console.log("smoke test passed");
