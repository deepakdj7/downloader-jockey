# Instagram resolver (HTTPS)

**Local default:** the repo ships [`server/python/main.py`](../../server/python/main.py) (Instaloader + FastAPI) on `http://localhost:3848` — no separate worker required for desktop use. It also exposes **`GET /api/instagram/auth/status`**, **`POST /api/instagram/auth/login`** with JSON `{ "username": "…", "password": "…" }`, and **`POST /api/instagram/auth/logout`** for optional UI login (password not stored client-side).

For a **remote** deployment (or custom logic), implement **any** HTTPS backend with this JSON API; the browser **fetches** the media URLs you return (CORS must allow the app origin).

## Endpoints (same origin = base URL you paste in ⋯)

Both accept JSON `POST` body: `{ "url": "<instagram post or reel url>" }`.

### `POST /api/instagram/preview`

Returns metadata for the right-hand preview card:

```json
{
  "url": "https://www.instagram.com/p/…/",
  "title": "Post title",
  "description": "Caption text",
  "thumbnail": "https://…"
}
```

Shape matches `PreviewMeta` in the Angular app.

### `POST /api/instagram/resolve`

Returns **direct** URLs to image/video bytes that the browser can `fetch` with `mode: 'cors'` (or proxy them through this same worker so media is **same-origin**).

```json
{
  "title": "…",
  "description": "…",
  "thumbnail": "https://…",
  "items": [
    { "url": "https://cdn…/1.jpg", "filename": "slide-1.jpg" },
    { "url": "https://cdn…/2.mp4", "filename": "slide-2.mp4" }
  ]
}
```

Carousel = multiple `items`. Filenames are used for “Save” buttons.

## CORS

Allow your GitHub Pages origin (or `*` for experiments):

```
Access-Control-Allow-Origin: https://<user>.github.io
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Handle `OPTIONS` preflight.

## Implementations

- **Cloudflare Worker**, **AWS Lambda**, **Fly.io**, etc.: receive POST, call your chosen upstream (your own scraper, a paid API you trust), map the response to the JSON above.
- Do **not** ship Instagram credentials in the public PWA; keep secrets in worker env vars.

See `cloudflare-worker.example.js` for a minimal skeleton.
