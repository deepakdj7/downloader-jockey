"""
Instagram API for DownloaderJockey using Instaloader (https://github.com/instaloader/instaloader).
Run: python -m uvicorn main:app --host 127.0.0.1 --port 3848 --reload --app-dir server/python
(from repo root: cd server/python && python -m uvicorn main:app --port 3848)
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import uuid
from pathlib import Path
from urllib.parse import quote, unquote

import instaloader
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STORAGE = BASE_DIR / ".ig-downloads"
STORAGE.mkdir(exist_ok=True)

MEDIA_SUFFIX = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm", ".mkv", ".mov"}

app = FastAPI(title="DownloaderJockey Instagram (Instaloader)")

log = logging.getLogger("ig-api")

# One shared Instaloader + session. Creating a new loader per request re-runs login()
# (very slow) when INSTALOADER_USER is set; Instagram HTTP calls also default to a
# 300s timeout, which looks like “no response” in the browser.
_loader: instaloader.Instaloader | None = None
_loader_lock = threading.Lock()
# Set when env or UI login succeeded; used only for /auth/status (memory-only session).
_ig_username: str | None = None


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UrlBody(BaseModel):
    url: str


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=500)


def _create_instaloader() -> instaloader.Instaloader:
    req_timeout = float(os.environ.get("INSTALOADER_REQUEST_TIMEOUT", "120"))
    iphone = os.environ.get("INSTALOADER_IPHONE_SUPPORT", "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    return instaloader.Instaloader(
        sleep=False,
        quiet=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        max_connection_attempts=3,
        request_timeout=req_timeout,
        iphone_support=iphone,
    )


def get_loader() -> instaloader.Instaloader:
    """Lazy singleton: optional INSTALOADER_USER login once; UI login replaces the loader."""
    global _loader, _ig_username
    with _loader_lock:
        if _loader is None:
            L = _create_instaloader()
            user = os.environ.get("INSTALOADER_USER")
            password = os.environ.get("INSTALOADER_PASS", "")
            if user:
                try:
                    log.info("Logging in with INSTALOADER_USER (env)…")
                    L.login(user, password)
                    _ig_username = user
                    log.info("Instagram login OK (env).")
                except Exception as exc:
                    log.warning("Env Instagram login failed (anonymous mode): %s", exc)
                    _ig_username = None
            _loader = L
        return _loader


@app.get("/api/instagram/auth/status")
def instagram_auth_status():
    with _loader_lock:
        if _loader is None:
            return {"loggedIn": False, "username": None}
        return {"loggedIn": _ig_username is not None, "username": _ig_username}


@app.post("/api/instagram/auth/login")
def instagram_auth_login(body: LoginBody):
    """Password is not stored; Instaloader keeps the session in this process only."""
    global _loader, _ig_username
    with _loader_lock:
        L = _create_instaloader()
        try:
            L.login(body.username.strip(), body.password)
        except Exception as exc:
            log.warning("Instagram UI login failed: %s", exc)
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        _loader = L
        _ig_username = body.username.strip()
        log.info("Instagram login OK (UI session) as %s", _ig_username)
    return {"ok": True, "username": _ig_username}


@app.post("/api/instagram/auth/logout")
def instagram_auth_logout():
    global _loader, _ig_username
    with _loader_lock:
        _loader = None
        _ig_username = None
        log.info("Instagram session cleared (logout).")
    return {"ok": True}


def _instagram_upstream_http_exception(exc: Exception) -> HTTPException:
    """Instaloader/Instagram failures — not a malformed client URL (use 502)."""
    msg = str(exc).strip()
    hint = (
        " · Mitigations: increase INSTALOADER_REQUEST_TIMEOUT (e.g. 180), "
        "set INSTALOADER_USER/PASS, try INSTALOADER_IPHONE_SUPPORT=false, "
        "`pip install -U instaloader`, or another network/VPN."
    )
    return HTTPException(status_code=502, detail=msg + hint)


def shortcode_from_url(url: str) -> str | None:
    u = url.strip()
    for pat in (
        r"instagram\.com/p/([^/?#]+)",
        r"instagram\.com/reel/([^/?#]+)",
        r"instagram\.com/tv/([^/?#]+)",
    ):
        m = re.search(pat, u, re.I)
        if m:
            return m.group(1)
    return None


def thumbnail_for_post(post: instaloader.Post) -> str:
    try:
        if post.typename == "GraphSidecar":
            for node in post.get_sidecar_nodes():
                du = getattr(node, "display_url", None)
                if du:
                    return du
                vu = getattr(node, "video_url", None)
                if vu:
                    return vu
        if getattr(post, "is_video", False) and getattr(post, "video_url", None):
            return post.video_url
        return post.url or ""
    except Exception:
        return getattr(post, "url", "") or ""


def collect_media_files(job_dir: Path) -> list[Path]:
    """Prefer top-level media files; otherwise collect recursively (nested album folders)."""
    top = [p for p in job_dir.iterdir() if p.is_file() and p.suffix.lower() in MEDIA_SUFFIX]
    if top:
        return sorted(top)
    files: list[Path] = []
    for p in job_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in MEDIA_SUFFIX:
            files.append(p)
    return sorted(files)


@app.post("/api/instagram/preview")
def instagram_preview(body: UrlBody):
    code = shortcode_from_url(body.url)
    if not code:
        raise HTTPException(status_code=400, detail="Could not parse Instagram shortcode from URL")
    log.info("preview start shortcode=%s", code)
    L = get_loader()
    try:
        post = instaloader.Post.from_shortcode(L.context, code)
    except Exception as exc:
        log.exception("preview failed shortcode=%s", code)
        raise _instagram_upstream_http_exception(exc) from exc
    log.info("preview ok shortcode=%s", code)
    cap = post.caption or ""
    title = cap[:120] + ("…" if len(cap) > 120 else "") if cap.strip() else f"Post {code}"
    return {
        "url": body.url.strip(),
        "title": title,
        "description": cap,
        "thumbnail": thumbnail_for_post(post),
    }


@app.post("/api/instagram/resolve")
def instagram_resolve(body: UrlBody, request: Request):
    code = shortcode_from_url(body.url)
    if not code:
        raise HTTPException(status_code=400, detail="Could not parse Instagram shortcode from URL")
    log.info("resolve start shortcode=%s", code)
    job_id = str(uuid.uuid4())
    job_dir = STORAGE / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    L = get_loader()
    try:
        post = instaloader.Post.from_shortcode(L.context, code)
        L.download_post(post, target=str(job_dir))
    except Exception as exc:
        log.exception("resolve failed shortcode=%s", code)
        shutil.rmtree(job_dir, ignore_errors=True)
        raise _instagram_upstream_http_exception(exc) from exc
    log.info("resolve downloaded media shortcode=%s job=%s", code, job_id)

    paths = collect_media_files(job_dir)
    base = str(request.base_url).rstrip("/")
    items = []
    for p in paths:
        rel = p.relative_to(job_dir)
        rel_s = rel.as_posix()
        items.append(
            {
                "filename": rel_s,
                "url": f"{base}/api/instagram/files/{job_id}/{quote(rel_s, safe='/')}",
            }
        )

    if not items:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail="No media files saved. Log in with the lock icon, or set INSTALOADER_USER/INSTALOADER_PASS for private posts.",
        )

    cap = post.caption or ""
    title = cap[:120] + ("…" if len(cap) > 120 else "") if cap.strip() else code
    return {
        "title": title,
        "description": cap,
        "thumbnail": thumbnail_for_post(post),
        "items": items,
    }


@app.get("/api/instagram/files/{job_id}/{filename:path}")
def serve_instagram_file(job_id: str, filename: str):
    if ".." in job_id or "/" in job_id or "\\" in job_id:
        raise HTTPException(status_code=404)
    raw = unquote(filename)
    if raw.startswith("/") or ".." in raw.split("/"):
        raise HTTPException(status_code=404)
    job_root = (STORAGE / job_id).resolve()
    fp = (job_root / raw).resolve()
    try:
        fp.relative_to(job_root)
    except ValueError:
        raise HTTPException(status_code=404)
    if not fp.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(fp, filename=fp.name)


@app.get("/health")
def health():
    return {"ok": True, "service": "instaloader-api"}
