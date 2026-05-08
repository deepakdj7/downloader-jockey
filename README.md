# DownloaderJockey

Local Angular UI: paste or upload a JSON list of URLs, preview metadata, and download **YouTube** (via [yt-dlp](https://github.com/yt-dlp/yt-dlp)) and **Instagram** (via [Instaloader](https://github.com/instaloader/instaloader)).

| Platform     | Backend |
|-------------|---------|
| **YouTube** | Node API in `server/` — spawns `yt-dlp` + ffmpeg |
| **Instagram** | Python API in `server/python/` — uses Instaloader and serves files over HTTP for the browser |

---

## Prerequisites

Install these **once** on your machine:

| Requirement | Why |
|-------------|-----|
| **Node.js** (LTS recommended) + **npm** | Angular CLI and the YouTube API (`server/`) |
| **Python 3** + **pip** | Instagram API (`server/python/`) |
| **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** on your `PATH` | Resolving and downloading YouTube streams |
| **[ffmpeg](https://ffmpeg.org/)** on your `PATH` | Muxing/merging video+audio for YouTube |

**macOS (Homebrew):**

```bash
brew install node python yt-dlp ffmpeg
```

**Verify:**

```bash
node -v && npm -v && python3 --version && yt-dlp --version && ffmpeg -version | head -1
```

---

## Installation (automated)

From the **repository root** (`downloader-jockey/`), with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) already on your `PATH`:

```bash
npm run bootstrap
```

This runs `node scripts/bootstrap.mjs`, which:

1. `pip install -r server/python/requirements.txt` (tries `python3` then `python`)
2. `npm install` in the project root
3. `npm install` in `server/`

**Manual / venv (optional):** if you use a venv, activate it first, then `npm run bootstrap` so the same Python gets Instaloader.

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
npm run bootstrap
```

---

## Running the app

**First-time install + start everything** (after prerequisites):

```bash
npm run go
```

Equivalent to `npm run bootstrap && npm run start:all`.

**After dependencies are installed**, only:

```bash
npm run start:all
```

### What starts

| Service | URL | Role |
|---------|-----|------|
| Instagram (Instaloader) | `http://127.0.0.1:3848` | Preview + resolve + file URLs for IG downloads |
| YouTube (yt-dlp) | `http://localhost:3847` | Jobs + streams for YouTube |
| Angular dev server | `http://localhost:4200` | UI in the browser |

Open **`http://localhost:4200`**. Under **⋯** (settings), defaults should match the table above: **YouTube API base** → `http://localhost:3847`, **Instagram API** → `http://localhost:3848` (or leave as in `src/environments/environment.ts`).

Paste single URLs or a JSON list, e.g. `["https://www.instagram.com/p/…","https://www.instagram.com/reel/…","https://www.youtube.com/watch?v=…"]`.

### Instagram sign-in (lock icon, recommended)

Use the **lock** button in the header to sign in with your Instagram username and password. The password is sent **once** to your **local** Python API (`server/python/main.py`) over POST and is **not** stored in the browser (no `localStorage`). The API session lasts until you **Sign out**, restart the API, or **close the tab** (on unload we request logout; **page refresh** is skipped so the session survives reloads in the same tab). If you **reload** and then only **close** the tab, use **Sign out** or restart the API to clear the server. Use **HTTPS** if you ever expose this API beyond localhost.

Env vars `INSTALOADER_USER` / `INSTALOADER_PASS` still work for headless setups (applied when the loader is first created). After UI logout, if those env vars are set, the next request may **recreate** an env-based login—omit them if you rely only on the lock icon.

### Environment-based Instagram login (optional, headless)

Alternative to the header **lock** icon — use when you do not want to type credentials in the UI:

```bash
export INSTALOADER_USER="your_instagram_username"
export INSTALOADER_PASS="your_password"
npm run start:all
```

Instaloader may still persist session data under your OS temp directory; the UI never stores your password.

**Timeout & performance:** each HTTP call to Instagram uses **`INSTALOADER_REQUEST_TIMEOUT`** (default **120** seconds). Raise it if you see **Read timed out** (e.g. `export INSTALOADER_REQUEST_TIMEOUT=240` before `npm run start:all`). If the terminal only shows `OPTIONS … 200` and no `POST …` line yet, the request is still running—Uvicorn logs when the response **finishes**.

### “Read timed out” / `graphql/query` (502)

Instaloader talks to Instagram’s web GraphQL; a timeout means the response did not arrive in time (slow network, Instagram throttling, or blocking). Try in order:

1. **Longer timeout:** `export INSTALOADER_REQUEST_TIMEOUT=240` (or `300`).
2. **Log in** (often helps with blocks): use the **lock** icon in the app, or `INSTALOADER_USER` / `INSTALOADER_PASS`, then restart the IG API if you changed env vars.
3. **Alternate client mode:** `export INSTALOADER_IPHONE_SUPPORT=false` (some networks behave better).
4. **Update Instaloader:** `pip install -U instaloader`.
5. **Network:** try another Wi‑Fi/VPN/ISP — Instagram often rate-limits or stalls certain IPs.

**“400/502” in the browser Network tab:** the API is this repo’s **Fast**API app (`server/python/main.py`). Errors from Instagram/Instaloader are returned as JSON `{ "detail": "…" }` (often **502** for upstream failures: rate limits, timeouts, login required). The Angular UI reads that `detail` string. A **400** with “Could not parse shortcode” means the URL path did not look like `/p/…`, `/reel/…`, or `/tv/…`.

### YouTube cookies (optional)

```bash
export YTDLP_COOKIES="/absolute/path/to/cookies.txt"
# or: export YTDLP_COOKIES_FROM_BROWSER="chrome"
npm run start:all
```

## Run services separately

| Command | Purpose |
|--------|---------|
| `npm run bootstrap` | Install Python deps + root `npm` + `server/` `npm` |
| `npm run go` | `bootstrap` then `start:all` |
| `npm run start:ig-api` | Instaloader API only |
| `npm run start:yt-api` | YouTube API only |
| `npm run start` or `npm run start:ui` | Angular only |

## JSON batch format

`["url1","url2"]` or `{ "urls": [...] }` — mixed YouTube and Instagram rows use the correct backend.

## API contract (Instagram)

The UI expects `POST /api/instagram/preview` and `POST /api/instagram/resolve` as documented in [`workers/instagram-resolver/README.md`](workers/instagram-resolver/README.md). The local Python server adds **`GET /api/instagram/auth/status`**, **`POST /api/instagram/auth/login`**, and **`POST /api/instagram/auth/logout`** for the lock-icon flow (session held in the API process only).

## Fonts

**Plus Jakarta Sans** — loaded from Google Fonts in `src/index.html`.
