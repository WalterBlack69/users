// Home Cinema — single-page client. No framework, no build step.

const $ = (sel, root = document) => root.querySelector(sel);
const root = $("#root");

const COLORS = ["#e50914", "#f5a623", "#2dbd6e", "#1f8ef1", "#8e44ad", "#e84393", "#16a0a0", "#6c7a89"];
const EMOJI = ["🙂", "😎", "🤓", "🦊", "🐼", "🦁", "🐙", "🚀", "🎬", "🍿", "👾", "🌈", "⚽", "🎸", "🧙", "🐶"];
const RATINGS = ["G", "PG", "PG-13", "R", "NR"];
const KID_SAFE = new Set(["G", "PG"]);
const GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Horror", "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "Western"];

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  token: store.get("hc.token"),
  role: null,
  needsLogin: false,
  adminEnabled: false,
  chunkSize: 3 * 1024 * 1024,
  profiles: [],
  profile: null,
  movies: [],
  progress: {},
  tab: "home", // home | list | search
  query: "",
};

// ---------- helpers ----------
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(kid));
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

async function api(path, { method = "GET", body, raw, signal } = {}) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`/api/${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined), signal });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== "login") { state.token = null; store.set("hc.token", null); renderLogin(); }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

const mediaUrl = (path) => `/api/${path}${state.token ? `?t=${encodeURIComponent(state.token)}` : ""}`;
const posterUrl = (m) => m.hasPoster ? mediaUrl(`movies/${m.id}/poster`) : null;
const fmtDuration = (s) => { if (!s) return ""; const h = Math.floor(s / 3600); const m = Math.max(1, Math.round((s % 3600) / 60)); return h ? `${h}h ${m}m` : `${m}m`; };
const fmtSize = (b) => b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`;
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function visibleMovies() {
  const ready = state.movies.filter((m) => m.status === "ready");
  return state.profile?.kids ? ready.filter((m) => KID_SAFE.has(m.rating)) : ready;
}

function avatarEl(p, cls = "") {
  return el("div", { class: `avatar ${cls}`, style: { background: p.avatar.color } }, p.avatar.emoji);
}

function modal(content, { onClose } = {}) {
  const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); onClose?.(); };
  const esc = (e) => e.key === "Escape" && close();
  const overlay = el("div", { class: "overlay", onclick: (e) => e.target === overlay && close() },
    el("div", { class: "modal", role: "dialog", "aria-modal": "true" },
      el("button", { class: "icon-btn close", "aria-label": "Close", onclick: close }, "✕"),
      content));
  document.addEventListener("keydown", esc);
  document.body.append(overlay);
  return close;
}

// ---------- boot ----------
async function boot() {
  try {
    const s = await api("session");
    Object.assign(state, { role: s.role, needsLogin: s.needsLogin, adminEnabled: s.adminEnabled, chunkSize: s.chunkSize });
  } catch (e) {
    root.replaceChildren(el("div", { class: "center" }, el("div", { class: "logo" }, "HOME CINEMA"), el("p", {}, "Can't reach the server: " + e.message)));
    return;
  }
  if (!state.role) return renderLogin();
  await loadProfiles();
  const saved = store.get("hc.profile");
  const remembered = state.profiles.find((p) => p.id === saved);
  remembered ? selectProfile(remembered) : renderProfiles();
}

// ---------- login ----------
function renderLogin({ admin = false } = {}) {
  const err = el("div", { class: "error" });
  const input = el("input", { type: "password", autocomplete: "current-password", required: true, autofocus: true });
  const form = el("form", {
    class: "card",
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      try {
        const r = await api("login", { method: "POST", body: { password: input.value } });
        state.token = r.token; state.role = r.role;
        store.set("hc.token", r.token);
        if (admin && r.role !== "admin") { err.textContent = "That's not the admin password."; return; }
        admin ? renderUpload() : boot();
      } catch (ex) { err.textContent = ex.message; input.select(); }
    },
  },
    el("h2", {}, admin ? "Admin sign in" : "Enter the password"),
    el("div", { class: "field" }, el("label", {}, "Password"), input),
    err,
    el("button", { class: "btn primary", type: "submit" }, "Continue"),
    admin && el("button", { class: "btn", type: "button", style: { marginLeft: "8px" }, onclick: () => renderHome() }, "Cancel"));
  root.replaceChildren(el("div", { class: "center" }, el("div", { class: "logo" }, "HOME CINEMA"), form));
  input.focus();
}

// ---------- profiles ----------
async function loadProfiles() { state.profiles = await api("profiles"); }

function renderProfiles({ manage = false } = {}) {
  const tiles = state.profiles.map((p) => el("button", {
    class: "profile",
    onclick: () => manage ? editProfile(p) : selectProfile(p),
  },
    avatarEl(p),
    manage && el("span", { class: "edit-badge" }, "✎"),
    el("span", {}, p.name, p.kids && el("span", { class: "kid-tag" }, "KIDS"))));
  if (state.profiles.length < 6) {
    tiles.push(el("button", { class: "profile", onclick: () => editProfile(null) },
      el("div", { class: "avatar add" }, "+"), el("span", {}, "Add profile")));
  }
  root.replaceChildren(el("div", { class: "center" },
    el("div", { class: "logo" }, "HOME CINEMA"),
    el("h1", {}, manage ? "Manage profiles" : "Who's watching?"),
    el("div", { class: "profiles" }, tiles),
    state.profiles.length > 0 && el("button", { class: "btn", onclick: () => renderProfiles({ manage: !manage }) }, manage ? "Done" : "Manage profiles"),
    state.needsLogin && !manage && el("button", { class: "btn small", onclick: () => { store.set("hc.token", null); state.token = null; renderLogin(); } }, "Sign out")));
}

function editProfile(profile) {
  const draft = profile ? structuredClone(profile) : { name: "", kids: false, avatar: { emoji: EMOJI[Math.floor(Math.random() * EMOJI.length)], color: COLORS[state.profiles.length % COLORS.length] } };
  const err = el("div", { class: "error" });
  const preview = el("div");
  const name = el("input", { value: draft.name, maxLength: 20, placeholder: "Name", autofocus: true, oninput: () => { draft.name = name.value; } });
  const kids = el("input", { type: "checkbox", checked: draft.kids, onchange: () => { draft.kids = kids.checked; } });
  const colorBox = el("div", { class: "swatches" });
  const emojiBox = el("div", { class: "swatches" });
  const refresh = () => {
    preview.replaceChildren(avatarEl(draft));
    colorBox.replaceChildren(...COLORS.map((c) => el("button", { class: `swatch ${c === draft.avatar.color ? "on" : ""}`, style: { background: c }, "aria-label": c, onclick: () => { draft.avatar.color = c; refresh(); } })));
    emojiBox.replaceChildren(...EMOJI.map((e) => el("button", { class: `swatch ${e === draft.avatar.emoji ? "on" : ""}`, onclick: () => { draft.avatar.emoji = e; refresh(); } }, e)));
  };
  refresh();
  const close = modal(el("div", { class: "form" },
    el("h2", { class: "t" }, profile ? "Edit profile" : "New profile"),
    el("div", { style: { display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" } }, preview, el("div", { class: "field", style: { flex: 1, margin: 0 } }, el("label", {}, "Name"), name)),
    el("div", { class: "field" }, el("label", {}, "Colour"), colorBox),
    el("div", { class: "field" }, el("label", {}, "Icon"), emojiBox),
    el("label", { class: "check" }, kids, "Kids profile (only G and PG titles)"),
    err,
    el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
      el("button", {
        class: "btn primary",
        onclick: async () => {
          try {
            if (!draft.name.trim()) { err.textContent = "Please enter a name."; return; }
            const body = { name: draft.name, kids: draft.kids, avatar: draft.avatar };
            profile ? await api(`profiles/${profile.id}`, { method: "PUT", body }) : await api("profiles", { method: "POST", body });
            await loadProfiles(); close(); renderProfiles({ manage: true });
          } catch (e) { err.textContent = e.message; }
        },
      }, "Save"),
      profile && el("button", {
        class: "btn danger",
        onclick: async () => {
          if (!confirm(`Delete ${profile.name}? Their list and watch history will be removed.`)) return;
          await api(`profiles/${profile.id}`, { method: "DELETE" });
          if (store.get("hc.profile") === profile.id) store.set("hc.profile", null);
          await loadProfiles(); close(); renderProfiles({ manage: true });
        },
      }, "Delete"))));
  name.focus();
}

async function selectProfile(p) {
  state.profile = p;
  store.set("hc.profile", p.id);
  state.tab = "home"; state.query = "";
  root.replaceChildren(el("div", { class: "center" }, avatarEl(p), el("p", {}, "Loading…")));
  try {
    [state.movies, state.progress] = await Promise.all([api("movies"), api(`profiles/${p.id}/progress`)]);
  } catch (e) { toast(e.message); return renderProfiles(); }
  renderHome();
}

// ---------- home ----------
function nav() {
  const menu = el("div", { class: "menu hidden" },
    ...state.profiles.filter((p) => p.id !== state.profile.id).map((p) => el("button", { onclick: () => selectProfile(p) }, avatarEl(p, "sm"), p.name)),
    el("button", { onclick: () => { store.set("hc.profile", null); renderProfiles(); } }, "👥 Switch profile"),
    el("button", { onclick: () => { store.set("hc.profile", null); renderProfiles({ manage: true }); } }, "✎ Manage profiles"),
    state.role === "admin"
      ? el("button", { onclick: () => renderUpload() }, "⬆ Upload & library")
      : state.adminEnabled && el("button", { onclick: () => renderLogin({ admin: true }) }, "🔑 Admin sign in"),
    state.needsLogin && el("button", { onclick: () => { state.token = null; store.set("hc.token", null); store.set("hc.profile", null); renderLogin(); } }, "Sign out"));
  const tab = (id, label) => el("button", { class: `link ${state.tab === id ? "active" : ""}`, onclick: () => { state.tab = id; state.query = ""; renderHome(); } }, label);
  const search = el("input", {
    class: "search", type: "search", placeholder: "Search titles", value: state.query,
    oninput: () => { state.query = search.value; state.tab = state.query ? "search" : "home"; renderRows(); },
  });
  const bar = el("div", { class: "nav" },
    el("div", { class: "logo", style: { fontSize: "22px" } }, "HOME CINEMA"),
    tab("home", "Home"), tab("list", "My List"),
    el("div", { class: "spacer" }),
    search,
    el("div", { class: "menu-wrap" },
      el("button", { class: "icon-btn", style: { background: state.profile.avatar.color }, "aria-label": "Profile menu", onclick: (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); } }, state.profile.avatar.emoji),
      menu));
  document.addEventListener("click", () => menu.classList.add("hidden"), { once: true });
  return bar;
}

function renderHome() {
  const bar = nav();
  const main = el("main", { id: "main" });
  root.replaceChildren(bar, main);
  const onScroll = () => bar.classList.toggle("solid", window.scrollY > 40);
  window.onscroll = onScroll; onScroll();
  window.scrollTo(0, 0);
  renderRows();
}

function tileEl(m) {
  const prog = state.progress[m.id];
  const poster = posterUrl(m);
  const pct = prog && prog.d ? Math.min(100, (prog.t / prog.d) * 100) : 0;
  const hue = hash(m.title) % 360;
  return el("button", { class: "tile", onclick: () => openDetail(m), title: m.title },
    el("div", { class: `poster ${poster ? "" : "fallback"}`, style: poster ? { backgroundImage: `url(${poster})` } : { background: `linear-gradient(160deg, hsl(${hue} 55% 32%), hsl(${(hue + 50) % 360} 60% 16%))` } },
      !poster && m.title,
      pct > 0 && el("div", { class: "bar" }, el("i", { style: { width: `${pct}%` } }))),
    el("div", { class: "cap" }, m.title));
}

const rowEl = (title, movies) => movies.length ? el("section", { class: "row-block" }, el("h3", {}, title), el("div", { class: "scroller" }, movies.map(tileEl))) : null;

function renderRows() {
  const main = $("#main");
  if (!main) return;
  const all = visibleMovies();
  const byNew = [...all].sort((a, b) => b.addedAt - a.addedAt);
  const kids = [];

  if (state.tab === "search" || state.tab === "list") {
    const q = state.query.trim().toLowerCase();
    const list = state.tab === "list"
      ? all.filter((m) => state.profile.list?.includes(m.id))
      : all.filter((m) => [m.title, m.genre, m.description, String(m.year)].some((f) => f?.toLowerCase().includes(q)));
    kids.push(el("div", { class: "rows top" },
      el("h3", { style: { padding: "0 var(--gutter)", marginBottom: "14px" } }, state.tab === "list" ? "My List" : `Results for “${state.query}”`),
      list.length ? el("div", { class: "grid" }, list.map(tileEl)) : el("div", { class: "empty-state" }, state.tab === "list" ? "Nothing here yet. Open a title and choose “+ My List”." : "No matches.")));
    return main.replaceChildren(...kids);
  }

  if (!all.length) {
    kids.push(el("div", { class: "hero empty" }, el("div", {},
      el("h1", {}, state.profile.kids ? "No kids’ titles yet" : "Your library is empty"),
      el("p", {}, state.role === "admin" ? "Upload your first movie to get started." : "Ask the library owner to add some movies."),
      state.role === "admin" && el("div", { class: "actions" }, el("button", { class: "btn primary", onclick: () => renderUpload() }, "⬆ Upload a movie")))));
    return main.replaceChildren(...kids);
  }

  const featured = byNew.find((m) => m.hasPoster) || byNew[0];
  const poster = posterUrl(featured);
  const resumeAt = state.progress[featured.id];
  kids.push(el("div", { class: "hero", style: poster ? { backgroundImage: `url(${poster})` } : { background: "radial-gradient(circle at 70% 20%, #3a1018, var(--bg) 65%)" } },
    el("div", {},
      el("h1", {}, featured.title),
      metaEl(featured),
      el("p", {}, featured.description),
      el("div", { class: "actions" },
        el("button", { class: "btn light", onclick: () => play(featured) }, resumeAt ? "▶ Resume" : "▶ Play"),
        el("button", { class: "btn", onclick: () => openDetail(featured) }, "ⓘ More info")))));

  const rows = [];
  const cont = all.filter((m) => state.progress[m.id]).sort((a, b) => state.progress[b.id].at - state.progress[a.id].at);
  rows.push(rowEl("Continue watching", cont));
  rows.push(rowEl("My List", all.filter((m) => state.profile.list?.includes(m.id))));
  rows.push(rowEl("Recently added", byNew.slice(0, 20)));
  const genres = [...new Set(all.map((m) => m.genre))].sort();
  for (const g of genres) rows.push(rowEl(g, byNew.filter((m) => m.genre === g)));
  kids.push(el("div", { class: "rows" }, rows));
  main.replaceChildren(...kids);
}

function metaEl(m) {
  return el("div", { class: "meta" }, el("span", {}, m.year), el("span", { class: "pill" }, m.rating), fmtDuration(m.duration) && el("span", {}, fmtDuration(m.duration)), el("span", {}, m.genre));
}

// ---------- detail ----------
function openDetail(m) {
  const poster = posterUrl(m);
  const prog = state.progress[m.id];
  const inList = () => state.profile.list?.includes(m.id);
  const listBtn = el("button", { class: "btn", onclick: async () => {
    const r = await api(`profiles/${state.profile.id}/list`, { method: "POST", body: { movieId: m.id, on: !inList() } });
    state.profile.list = r.list; paint(); renderRows();
  } });
  const paint = () => { listBtn.textContent = inList() ? "✓ In My List" : "+ My List"; };
  paint();
  const close = modal(el("div", {},
    el("div", { class: "detail-top", style: poster ? { backgroundImage: `url(${poster})` } : { background: "linear-gradient(160deg, #3a1018, #17171e)" } }, el("h2", {}, m.title)),
    el("div", { class: "detail-body" },
      metaEl(m),
      el("p", {}, m.description || "No description."),
      el("div", { class: "actions" },
        el("button", { class: "btn light", onclick: () => { close(); play(m); } }, prog ? `▶ Resume (${fmtDuration(prog.t) || "0m"} in)` : "▶ Play"),
        prog && el("button", { class: "btn", onclick: async () => { close(); await saveProgress(m, 0, 0); play(m, 0); } }, "⟲ Start over"),
        listBtn,
        state.role === "admin" && el("button", { class: "btn danger", onclick: async () => {
          if (!confirm(`Permanently delete “${m.title}”?`)) return;
          await api(`movies/${m.id}`, { method: "DELETE" });
          state.movies = state.movies.filter((x) => x.id !== m.id); close(); renderRows(); toast("Deleted");
        } }, "Delete")))));
}

// ---------- player ----------
async function saveProgress(m, t, d) {
  if (!t || t < 5 || (d && t > d * 0.95)) delete state.progress[m.id];
  else state.progress[m.id] = { t: Math.floor(t), d: Math.floor(d || 0), at: Date.now() };
  try { await api(`profiles/${state.profile.id}/progress`, { method: "PUT", body: { movieId: m.id, t, d } }); } catch { /* best effort */ }
}

function play(m, startAt) {
  const prog = state.progress[m.id];
  const video = el("video", { controls: true, autoplay: true, playsInline: true, preload: "auto", src: mediaUrl(`movies/${m.id}/stream`) });
  const msg = el("div", { class: "msg hidden" });
  const wrap = el("div", { class: "player" },
    video, msg,
    el("div", { class: "top" }, el("button", { class: "icon-btn", "aria-label": "Back", onclick: () => stop() }, "←"), el("b", {}, m.title)));
  let seeded = false, lastSave = 0, idleTimer;
  video.addEventListener("loadedmetadata", () => {
    if (seeded) return; seeded = true;
    const t = startAt ?? (prog && prog.t < video.duration - 10 ? prog.t : 0);
    if (t) video.currentTime = t;
  });
  video.addEventListener("timeupdate", () => {
    if (Date.now() - lastSave > 10000 && video.currentTime > 0) { lastSave = Date.now(); saveProgress(m, video.currentTime, video.duration); }
  });
  video.addEventListener("pause", () => { if (video.currentTime > 0 && !video.ended) saveProgress(m, video.currentTime, video.duration); });
  video.addEventListener("ended", () => { saveProgress(m, video.duration, video.duration); });
  video.addEventListener("error", () => {
    msg.classList.remove("hidden");
    msg.replaceChildren(el("b", {}, "This file can't be played in your browser."), el("span", {}, "MP4 (H.264 video + AAC audio) or WebM work everywhere. MKV/AVI usually don't — convert with HandBrake or ffmpeg and re-upload."));
  });
  const wake = () => { wrap.classList.remove("idle"); clearTimeout(idleTimer); idleTimer = setTimeout(() => !video.paused && wrap.classList.add("idle"), 2800); };
  wrap.addEventListener("mousemove", wake); wrap.addEventListener("touchstart", wake); wake();
  const onKey = (e) => {
    if (e.key === "Escape" && !document.fullscreenElement) stop();
    else if (e.key === " " && e.target === document.body) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (e.key === "ArrowRight") video.currentTime += 10;
    else if (e.key === "ArrowLeft") video.currentTime -= 10;
    else if (e.key === "f") document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen?.();
  };
  function stop() {
    if (video.currentTime > 0) saveProgress(m, video.currentTime, video.duration).then(() => renderRows());
    document.removeEventListener("keydown", onKey);
    clearTimeout(idleTimer);
    video.removeAttribute("src"); video.load();
    wrap.remove();
    if (document.fullscreenElement) document.exitFullscreen();
    renderRows();
  }
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
}

// ---------- upload & library (admin) ----------
function captureFrame(file) {
  // Grab a poster frame + duration from the local file; fails gracefully for unsupported codecs.
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (r) => { URL.revokeObjectURL(url); resolve(r); };
    const timer = setTimeout(() => done({ duration: 0, blob: null }), 15000);
    v.muted = true; v.preload = "metadata"; v.src = url;
    v.onerror = () => { clearTimeout(timer); done({ duration: 0, blob: null }); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(v.duration * 0.1, 120) || 0; };
    v.onseeked = () => {
      clearTimeout(timer);
      const h = 600, w = Math.round((h * v.videoWidth) / v.videoHeight) || 400;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(v, 0, 0, w, h);
      c.toBlob((blob) => done({ duration: v.duration || 0, blob }), "image/jpeg", 0.8);
    };
  });
}

async function resizePoster(file) {
  const img = await createImageBitmap(file);
  const h = Math.min(900, img.height), w = Math.round((img.width * h) / img.height);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
}

async function putWithRetry(path, body, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await api(path, { method: "PUT", raw: body }); }
    catch (e) { if (i >= tries - 1) throw e; await new Promise((r) => setTimeout(r, 800 * 2 ** i)); }
  }
}

async function uploadChunks(movie, file, onProgress) {
  const size = state.chunkSize;
  const { have } = await api(`movies/${movie.id}/chunks`);
  const todo = [];
  for (let n = 0; n < Math.ceil(file.size / size); n++) if (!have.includes(n)) todo.push(n);
  let done = Math.ceil(file.size / size) - todo.length;
  const total = Math.ceil(file.size / size);
  onProgress(done / total);
  const worker = async () => {
    while (todo.length) {
      const n = todo.shift();
      await putWithRetry(`movies/${movie.id}/chunks/${n}`, file.slice(n * size, (n + 1) * size));
      onProgress(++done / total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await api(`movies/${movie.id}/complete`, { method: "POST" });
}

async function renderUpload() {
  if (state.role !== "admin") return renderLogin({ admin: true });
  state.movies = await api("movies");
  const f = { file: null, posterBlob: null, duration: 0, posterFromUser: false };
  const err = el("div", { class: "error" });
  const status = el("div", { class: "meta" });
  const bar = el("i"); const progress = el("div", { class: "progress hidden" }, bar);
  const fileInput = el("input", { type: "file", accept: "video/*", class: "hidden" });
  const drop = el("div", { class: "drop", tabIndex: 0, role: "button" }, "Click or drop a video file here (MP4 / WebM recommended)");
  const title = el("input", { maxLength: 120, required: true });
  const year = el("input", { type: "number", min: 1880, max: 2100, value: new Date().getFullYear() });
  const genre = el("select", {}, GENRES.map((g) => el("option", { value: g }, g)));
  const rating = el("select", {}, RATINGS.map((r) => el("option", { value: r, selected: r === "PG-13" }, r)));
  const desc = el("textarea", { rows: 3, maxLength: 1000 });
  const posterInput = el("input", { type: "file", accept: "image/*" });
  const submit = el("button", { class: "btn primary", type: "submit" }, "⬆ Upload");

  const setFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|m4v|webm|mov|mkv)$/i.test(file.name)) { err.textContent = "Please choose a video file."; return; }
    err.textContent = ""; f.file = file;
    drop.textContent = `${file.name} — ${fmtSize(file.size)}`;
    if (!title.value) title.value = file.name.replace(/\.[^.]+$/, "").replace(/[._]+/g, " ").trim();
    status.textContent = "Reading video…";
    const r = await captureFrame(file);
    f.duration = r.duration;
    if (!f.posterFromUser) f.posterBlob = r.blob;
    status.textContent = r.duration ? `${fmtDuration(r.duration)}${r.blob ? " · poster frame captured" : ""}` : "Couldn't preview this format locally — it may not play in browsers (see README).";
  };
  fileInput.onchange = () => setFile(fileInput.files[0]);
  drop.onclick = () => fileInput.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); setFile(e.dataTransfer.files[0]); };
  posterInput.onchange = async () => { if (posterInput.files[0]) { f.posterBlob = await resizePoster(posterInput.files[0]); f.posterFromUser = true; } };

  const form = el("form", {
    class: "panel",
    onsubmit: async (e) => {
      e.preventDefault();
      if (!f.file) { err.textContent = "Choose a video file first."; return; }
      err.textContent = ""; submit.disabled = true; progress.classList.remove("hidden");
      try {
        const movie = await api("movies", { method: "POST", body: {
          title: title.value, year: year.value, genre: genre.value, rating: rating.value, description: desc.value,
          size: f.file.size, type: f.file.type || "video/mp4", duration: f.duration,
        } });
        if (f.posterBlob) await putWithRetry(`movies/${movie.id}/poster`, f.posterBlob);
        await uploadChunks(movie, f.file, (p) => { bar.style.width = `${p * 100}%`; status.textContent = `Uploading… ${Math.round(p * 100)}%`; });
        toast(`“${movie.title}” is ready to watch`);
        renderUpload();
      } catch (ex) { err.textContent = ex.message + " — you can resume from the library below."; submit.disabled = false; renderLibrary(); }
    },
  },
    el("h2", { style: { marginBottom: "14px" } }, "Upload a movie"),
    fileInput, drop,
    el("div", { class: "field" }, el("label", {}, "Title"), title),
    el("div", { class: "row" },
      el("div", { class: "field" }, el("label", {}, "Year"), year),
      el("div", { class: "field" }, el("label", {}, "Genre"), genre),
      el("div", { class: "field" }, el("label", {}, "Rating"), rating)),
    el("div", { class: "field" }, el("label", {}, "Description"), desc),
    el("div", { class: "field" }, el("label", {}, "Poster image (optional — a frame from the movie is used otherwise)"), posterInput),
    progress, status, err, submit);

  const library = el("div", { class: "panel" });
  function renderLibrary() {
    library.replaceChildren(
      el("h2", { style: { marginBottom: "6px" } }, `Library (${state.movies.length})`),
      !state.movies.length && el("p", { class: "meta" }, "Nothing uploaded yet."),
      ...[...state.movies].sort((a, b) => b.addedAt - a.addedAt).map((m) => {
        const resume = el("input", { type: "file", accept: "video/*", class: "hidden", onchange: async () => {
          const file = resume.files[0];
          if (!file) return;
          if (file.size !== m.size) return toast("That's not the same file (size differs).");
          try {
            await uploadChunks(m, file, (p) => toast(`Resuming… ${Math.round(p * 100)}%`));
            toast("Upload complete"); renderUpload();
          } catch (e) { toast(e.message); }
        } });
        return el("div", { class: "lib-item" },
          el("div", { class: "thumb", style: posterUrl(m) ? { backgroundImage: `url(${posterUrl(m)})` } : {} }),
          el("div", { class: "info" }, el("b", {}, m.title), el("span", {}, `${m.year} · ${m.rating} · ${fmtSize(m.size)}`, m.status !== "ready" && " · ⚠ incomplete")),
          m.status !== "ready" && [resume, el("button", { class: "btn small", onclick: () => resume.click() }, "Resume")],
          el("button", { class: "btn small danger", onclick: async () => {
            if (!confirm(`Delete “${m.title}”?`)) return;
            await api(`movies/${m.id}`, { method: "DELETE" });
            state.movies = state.movies.filter((x) => x.id !== m.id); renderLibrary();
          } }, "Delete"));
      }));
  }
  renderLibrary();

  root.replaceChildren(
    el("div", { class: "nav solid" }, el("div", { class: "logo", style: { fontSize: "22px" } }, "HOME CINEMA"), el("div", { class: "spacer" }),
      el("button", { class: "btn small", onclick: async () => { if (state.profile) { await selectProfile(state.profile); } else { await boot(); } } }, "← Back to watching")),
    el("div", { class: "page" }, el("h1", {}, "Upload & library"), form, library));
}

boot();
