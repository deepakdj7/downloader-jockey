import express from 'express';
import cors from 'cors';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_ROOT = path.join(__dirname, '.job-store');
const PORT = Number(process.env.PORT ?? 3847);

const app = express();
app.use(
  cors({
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  }),
);
app.options('*', cors());
app.use(express.json({ limit: '32kb' }));

/** @type {Map<string, any>} */
const jobs = new Map();

function assertYoutubeUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL');
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const allowed =
    host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  if (!allowed) {
    throw new Error(
      'This server only handles YouTube. Instagram uses the Instaloader API (see README / server/python).',
    );
  }
}

function ytDlpAuthPrefix() {
  const args = [];
  const cookieFile = process.env.YTDLP_COOKIES?.trim();
  const browser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (cookieFile) {
    if (fs.existsSync(cookieFile)) {
      args.push('--cookies', cookieFile);
    } else {
      console.warn(`[yt-dlp] YTDLP_COOKIES file not found: ${cookieFile}`);
    }
  } else if (browser) {
    args.push('--cookies-from-browser', browser);
  }
  return args;
}

/**
 * @param {string} urlStr
 * @param {'video' | 'mp3'} youtubeFormat
 * @param {string} outDir
 */
function buildYtDlpArgs(urlStr, youtubeFormat, outDir) {
  const auth = ytDlpAuthPrefix();
  if (youtubeFormat === 'mp3') {
    return [
      ...auth,
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '--no-warnings',
      '-o',
      path.join(outDir, '%(title)s-%(id)s.%(ext)s'),
      '--',
      urlStr,
    ];
  }
  return [
    ...auth,
    '-f',
    'bestvideo+bestaudio/best',
    '--merge-output-format',
    'mp4',
    '--no-warnings',
    '-o',
    path.join(outDir, '%(title)s-%(id)s.%(ext)s'),
    '--',
    urlStr,
  ];
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => {
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (!st.isFile()) return null;
      return { name, size: st.size };
    })
    .filter(Boolean);
}

function pickThumbnail(data) {
  if (data.thumbnail && typeof data.thumbnail === 'string') return data.thumbnail;
  const thumbs = data.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length) {
    const last = thumbs[thumbs.length - 1];
    if (last?.url) return last.url;
  }
  return undefined;
}

function mapYtDlpDump(data, urlStr) {
  const entries = Array.isArray(data.entries) ? data.entries : null;
  if (entries && entries.length > 0) {
    const first = entries[0];
    return {
      url: urlStr,
      title: data.title || first?.title || 'Playlist',
      description:
        (typeof data.description === 'string' ? data.description : '') ||
        (typeof first?.description === 'string' ? first.description : '') ||
        '',
      thumbnail: pickThumbnail(first) || pickThumbnail(data),
      itemCount: entries.length,
    };
  }
  return {
    url: urlStr,
    title: typeof data.title === 'string' ? data.title : 'Untitled',
    description: typeof data.description === 'string' ? data.description : '',
    thumbnail: pickThumbnail(data),
    itemCount: undefined,
  };
}

app.post('/api/preview', (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const target = url.trim();
  try {
    assertYoutubeUrl(target);
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) });
  }
  try {
    const auth = ytDlpAuthPrefix();
    const out = execFileSync(
      'yt-dlp',
      [...auth, '-J', '--skip-download', '--no-warnings', '--no-playlist', '--', target],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120000,
      },
    );
    const data = JSON.parse(out);
    const meta = mapYtDlpDump(data, target);
    res.json(meta);
  } catch (e) {
    const stderr = e?.stderr?.toString?.() ?? e?.message ?? String(e);
    res.status(400).json({
      error: stderr.slice(-4000) || 'Preview failed (yt-dlp)',
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.type('text').send('ok');
});

app.post('/api/jobs', (req, res) => {
  const { url, youtubeFormat } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const target = url.trim();
  try {
    assertYoutubeUrl(target);
  } catch (e) {
    return res.status(400).json({ error: String(e?.message ?? e) });
  }

  const jobId = randomUUID();
  const jobDir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const format = youtubeFormat === 'mp3' ? 'mp3' : 'video';
  const args = buildYtDlpArgs(target, format, jobDir);

  const record = {
    id: jobId,
    state: /** @type {'pending' | 'running' | 'complete' | 'error'} */ ('running'),
    progress: 0,
    line: 'Starting yt-dlp…',
    files: /** @type { { name: string; size: number; href: string }[] } */ ([]),
    error: /** @type {string | undefined} */ (undefined),
  };
  jobs.set(jobId, record);

  const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';

  const onChunk = (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      record.line = line.slice(0, 300);
      const m = line.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) record.progress = Math.min(99, parseFloat(m[1]));
    }
  };
  child.stderr.on('data', onChunk);
  child.stdout.on('data', onChunk);

  child.on('error', (err) => {
    record.state = 'error';
    record.error =
      err.code === 'ENOENT'
        ? 'yt-dlp not found. Install from https://github.com/yt-dlp/yt-dlp and ensure it is on PATH.'
        : String(err.message ?? err);
  });

  child.on('close', (code) => {
    if (record.state === 'error') return;
    if (code !== 0) {
      record.state = 'error';
      record.error = (buf + record.line).slice(-4000) || `yt-dlp exited with code ${code}`;
      return;
    }
    const files = listFiles(jobDir);
    if (files.length === 0) {
      record.state = 'error';
      record.error = 'No output files were produced.';
      return;
    }
    record.state = 'complete';
    record.progress = 100;
    record.files = files.map((f) => ({
      name: f.name,
      size: f.size,
      href: `/api/jobs/${jobId}/files/${encodeURIComponent(f.name)}`,
    }));
  });

  res.json({ jobId });
});

app.get('/api/jobs/:id', (req, res) => {
  const r = jobs.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({
    id: r.id,
    state: r.state === 'running' ? 'running' : r.state,
    progress: r.progress,
    line: r.line,
    files: r.files,
    error: r.error,
  });
});

app.get('/api/jobs/:id/files/:name', (req, res) => {
  const r = jobs.get(req.params.id);
  if (!r || r.state !== 'complete') return res.status(404).end('Not ready');
  const safeName = path.basename(req.params.name);
  const fp = path.join(JOBS_ROOT, req.params.id, safeName);
  const root = path.join(JOBS_ROOT, req.params.id);
  if (!fp.startsWith(root) || !fs.existsSync(fp)) return res.status(404).end();
  res.download(fp, safeName);
});

app.listen(PORT, () => {
  console.log(`DownloaderJockey YouTube API (yt-dlp) on http://localhost:${PORT}`);
  const cf = process.env.YTDLP_COOKIES?.trim();
  const br = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (cf && fs.existsSync(cf)) console.log(`[yt-dlp] using cookies file: ${cf}`);
  else if (br) console.log(`[yt-dlp] using --cookies-from-browser ${br}`);
});
