# Home Cinema

A private, self-hosted streaming site for your own movies — Netflix-style UI, viewing profiles,
resume where you left off, My List, kids profiles — built to deploy on **Netlify**
(static site + Netlify Functions + Netlify Blobs). No database or server to run.

## Deploy on Netlify

1. Push this repo to GitHub and choose **Add new site → Import an existing project** in Netlify.
   `netlify.toml` already sets the publish folder (`public`) and functions folder — no build command needed.
2. In **Site configuration → Environment variables** add:

   | Variable | Purpose |
   |---|---|
   | `ADMIN_PASSWORD` | **Required for uploading/deleting.** Without it, uploads are disabled. |
   | `ACCESS_PASSWORD` | Optional. If set, everyone must enter it to watch. Strongly recommended — otherwise anyone with the URL can watch. |

3. Deploy. Open the site → create profiles → profile menu → **Admin sign in** → **Upload & library**.

Local try-out: `npm install && npm test` (API smoke test), `npm run dev` (Netlify CLI), or
`ADMIN_PASSWORD=x ACCESS_PASSWORD=y node test/devserver.mjs` (no Netlify account needed; data in `.local-data/`).

## Features

- **Profiles** (up to 6): name, colour, icon, optional **Kids** mode (shows only G / PG titles).
- Per-profile **Continue watching**, **My List**, resume position and "Start over".
- **Uploads** from the browser: drag & drop, automatic poster frame (or choose your own image), resumable chunked upload with 3 parallel streams and retries.
- Search, genre rows, hero banner, keyboard shortcuts in the player (Space, ←/→ 10s, F, Esc).

## How it works / limits

- Netlify Functions can't pass bodies over ~6 MB, so movies are split into 3 MB chunks stored in Netlify Blobs and
  streamed back with HTTP range requests (seeking works). See `netlify/functions/api.mjs`.
- **Format:** browsers play **MP4 (H.264 + AAC)** and **WebM**. MKV/AVI usually won't — convert first, e.g.
  `ffmpeg -i in.mkv -c:v libx264 -c:a aac -movflags +faststart out.mp4`.
- **Cost/bandwidth:** every minute watched is served through Netlify, so large libraries or many viewers can
  exceed free-tier bandwidth/function limits. For a big catalogue, move the chunk storage to S3/R2 (only `media()` in the API changes).
- Kids filtering and profile separation are conveniences for a household, not security boundaries — access control is the two passwords.
- Only upload content you own or have the right to stream.
