# Instagram resolver (HTTPS)

The PWA on **GitHub Pages** cannot talk to Instagram directly (CORS, auth, bot checks). You deploy **any** HTTPS backend that implements this JSON API; the app runs entirely in the browser and **fetches media URLs you return**.

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
