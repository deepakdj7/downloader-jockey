# DownloaderJockey

Angular **PWA** (works on **GitHub Pages**): one screen to paste YouTube or Instagram links, preview metadata, and download.

| Platform    | How it works |
|------------|----------------|
| **YouTube** | Optional **Node companion** in `/server` uses **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** + ffmpeg for highest-quality video/MP3. |
| **Instagram** | **Not** yt-dlp. The static app calls **your** HTTPS **resolver** (Cloudflare Worker, etc.) that returns direct media URLs. See [`workers/instagram-resolver`](workers/instagram-resolver/README.md). |

GitHub Pages only hosts static files — it cannot run yt-dlp or scrape Instagram. You deploy backends separately (or only YouTube locally).

## Quick start (local)

### 1. YouTube API (yt-dlp)

Install yt-dlp and ffmpeg, then:

```bash
cd server
npm install
npm start
```

Default URL: **`http://localhost:3847`** — paste this under **⋯ → YouTube API base URL** or keep `environment.ts` default.

Optional cookie auth for restricted YouTube:

```bash
export YTDLP_COOKIES="/absolute/path/to/cookies.txt"
# or: export YTDLP_COOKIES_FROM_BROWSER="chrome"
npm start
```

### 2. Instagram resolver (HTTPS)

Implement **`POST /api/instagram/preview`** and **`POST /api/instagram/resolve`** as documented in [`workers/instagram-resolver/README.md`](workers/instagram-resolver/README.md). Deploy to a URL like `https://your-worker.workers.dev`, then paste that origin under **⋯ → Instagram resolver base URL**.

Without a resolver, Instagram previews/downloads stay disabled; the UI explains this.

### 3. Angular app

```bash
npm install
npm start
```

Open `http://localhost:4200`. Use **⋯** if either backend URL is missing.

**JSON batch:** `["url1","url2"]` or `{ "urls": [...] }` — mixed YouTube/Instagram rows each use the correct backend.

## GitHub Pages

`angular.json` → configuration **`gh`** → **`baseHref`** is `/downloader-jockey/` (change if your repo name differs).

```bash
npm run build:gh
```

Publish `dist/downloader-jockey-gh/browser/` (e.g. Actions workflow in `.github/workflows/gh-pages.yml`).

After deploy: **⋯** → set **YouTube API** (public `https://…` if you host the Node server) and **Instagram resolver** (`https://…` only). Both must send **CORS** headers for your Pages origin.

## Fonts

**Plus Jakarta Sans** — loaded from Google Fonts in `src/index.html`.
