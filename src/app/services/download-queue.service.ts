import { Injectable, inject, signal } from '@angular/core';
import { timer, switchMap, takeWhile, Subscription } from 'rxjs';
import {
  DownloadJob,
  JobStatusResponse,
  PreparedFile,
  YoutubeFormat,
} from '../models/download.models';
import { PlatformDetectorService } from './platform-detector.service';
import { DownloadApiService } from './download-api.service';
import { InstagramResolverService } from './instagram-resolver.service';
import { getHttpErrorMessage } from '../utils/http-error.util';

const RECENT_KEY = 'downloaderJockeyRecent';

export interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  accent: 'mint' | 'lavender' | 'sun';
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

@Injectable({
  providedIn: 'root',
})
export class DownloadQueueService {
  private readonly platform = inject(PlatformDetectorService);
  private readonly api = inject(DownloadApiService);
  private readonly instagram = inject(InstagramResolverService);

  readonly jobs = signal<DownloadJob[]>([]);
  readonly recent = signal<RecentItem[]>(this.loadRecent());

  private readonly pollSubs = new Map<string, Subscription>();

  constructor() {}

  canStart(url: string): { ok: true } | { ok: false; message: string } {
    const p = this.platform.detect(url);
    if (p === 'unknown') {
      return { ok: false, message: 'Paste a YouTube or Instagram link.' };
    }
    if (p === 'youtube' && !this.api.hasYoutubeApiConfigured()) {
      return {
        ok: false,
        message: 'Set the YouTube companion API URL (⋯) — used with yt-dlp for YouTube only.',
      };
    }
    if (p === 'instagram' && !this.instagram.hasResolver()) {
      return {
        ok: false,
        message:
          'Set the Instagram API URL under ⋯ (e.g. http://localhost:3848 when running npm run start:all).',
      };
    }
    return { ok: true };
  }

  addFromUrl(
    url: string,
    youtubeFormat: YoutubeFormat,
    displayLabel?: string,
  ): { ok: true; id: string } | { ok: false; message: string } {
    const gate = this.canStart(url);
    if (!gate.ok) return gate;
    const platform = this.platform.detect(url);
    const id = randomId();
    const label = displayLabel?.trim() || this.defaultLabel(url, platform);
    const job: DownloadJob = {
      id,
      url: url.trim(),
      platform,
      youtubeFormat,
      status: 'queued',
      progress: 0,
      label,
      detail:
        platform === 'youtube'
          ? youtubeFormat === 'mp3'
            ? 'MP3 (best audio)'
            : 'Video (best)'
          : 'Instagram',
      files: [],
    };
    this.jobs.update((list) => [job, ...list]);
    if (platform === 'instagram') {
      this.startInstagramJob(job);
    } else {
      this.startYoutubeJob(job);
    }
    return { ok: true, id };
  }

  removeJob(id: string): void {
    this.pollSubs.get(id)?.unsubscribe();
    this.pollSubs.delete(id);
    const job = this.jobs().find((j) => j.id === id);
    if (job?.files?.length) {
      for (const f of job.files) {
        if (f.href.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(f.href);
          } catch {
            /* ignore */
          }
        }
      }
    }
    this.jobs.update((list) => list.filter((j) => j.id !== id));
  }

  private defaultLabel(url: string, platform: DownloadJob['platform']): string {
    try {
      const u = new URL(url.includes('://') ? url : `https://${url}`);
      if (platform === 'youtube' && u.pathname.includes('/shorts/')) return 'YouTube Short';
      if (platform === 'youtube') return 'YouTube';
      return 'Instagram';
    } catch {
      return 'Download';
    }
  }

  private startYoutubeJob(job: DownloadJob): void {
    this.patchJob(job.id, { status: 'preparing', progress: 1, detail: 'Starting yt-dlp…' });
    this.api.createJob(job.url, job.youtubeFormat).subscribe({
      next: (res) => {
        this.patchJob(job.id, { serverJobId: res.jobId, status: 'preparing', progress: 5 });
        this.pollUntilDone(job.id, res.jobId);
      },
      error: (err) => {
        this.patchJob(job.id, {
          status: 'error',
          errorMessage: getHttpErrorMessage(err, 'Request failed'),
          progress: 0,
        });
      },
    });
  }

  private startInstagramJob(job: DownloadJob): void {
    this.patchJob(job.id, { status: 'preparing', progress: 10, detail: 'Contacting resolver…' });
    this.instagram.resolve(job.url).subscribe({
      next: async (res) => {
        const items = res.items ?? [];
        if (items.length === 0) {
          this.patchJob(job.id, {
            status: 'error',
            progress: 0,
            errorMessage: 'Resolver returned no media files.',
          });
          return;
        }
        this.patchJob(job.id, {
          progress: 25,
          detail: `Fetching ${items.length} file(s) in browser…`,
        });
        const files: PreparedFile[] = [];
        let idx = 0;
        for (const item of items) {
          try {
            const response = await fetch(item.url, { mode: 'cors' });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            files.push({
              name: item.filename || `media-${idx + 1}`,
              href: blobUrl,
              size: blob.size,
            });
          } catch (e) {
            this.patchJob(job.id, {
              status: 'error',
              progress: 0,
              errorMessage:
                `Could not download media (CORS or network). Use resolver URLs that allow browser fetch, or proxy through your worker. ${String(
                  (e as Error)?.message ?? e,
                )}`,
            });
            for (const f of files) {
              if (f.href.startsWith('blob:')) URL.revokeObjectURL(f.href);
            }
            return;
          }
          idx++;
          const pct = 25 + Math.round((75 * idx) / items.length);
          this.patchJob(job.id, {
            progress: Math.min(99, pct),
            detail: `Fetched ${idx}/${items.length}…`,
          });
        }
        this.patchJob(job.id, {
          status: 'complete',
          progress: 100,
          detail: items.length > 1 ? `${items.length} files ready` : 'Ready',
          files,
        });
        this.pushRecentFromJob(job.id);
      },
      error: (err) => {
        this.patchJob(job.id, {
          status: 'error',
          errorMessage: getHttpErrorMessage(err, 'Instagram resolver failed'),
          progress: 0,
        });
      },
    });
  }

  private pollUntilDone(localId: string, serverJobId: string): void {
    this.pollSubs.get(localId)?.unsubscribe();
    const sub = timer(0, 850)
      .pipe(
        switchMap(() => this.api.getJob(serverJobId)),
        takeWhile((s) => s.state === 'pending' || s.state === 'running', true),
      )
      .subscribe({
        next: (s) => this.applyServerStatus(localId, s),
        error: (err) => {
          this.patchJob(localId, {
            status: 'error',
            errorMessage: err?.message ?? 'Poll failed',
          });
          this.pollSubs.delete(localId);
        },
        complete: () => this.pollSubs.delete(localId),
      });
    this.pollSubs.set(localId, sub);
  }

  private applyServerStatus(localId: string, s: JobStatusResponse): void {
    const prog = Math.max(0, Math.min(100, s.progress ?? 0));
    if (s.state === 'pending' || s.state === 'running') {
      this.patchJob(localId, {
        status: 'preparing',
        progress: prog || 8,
        detail: s.line ?? 'Downloading with yt-dlp…',
      });
      return;
    }
    if (s.state === 'error') {
      this.patchJob(localId, {
        status: 'error',
        progress: 0,
        errorMessage: s.error ?? 'Server error',
      });
      return;
    }
    const files: PreparedFile[] = (s.files ?? []).map((f) => ({
      name: f.name,
      size: f.size,
      href: f.href,
    }));
    this.patchJob(localId, {
      status: 'complete',
      progress: 100,
      detail: files.length > 1 ? `${files.length} files ready` : 'Ready',
      files,
    });
    this.pushRecentFromJob(localId);
  }

  private patchJob(id: string, partial: Partial<DownloadJob>): void {
    this.jobs.update((list) =>
      list.map((j) => (j.id === id ? { ...j, ...partial } : j)),
    );
  }

  private pushRecentFromJob(localId: string): void {
    const job = this.jobs().find((j) => j.id === localId);
    if (!job || job.files.length === 0) return;
    const title = job.files[0]?.name ?? job.label;
    const item: RecentItem = {
      id: randomId(),
      title: title.replace(/\.[^.]+$/, ''),
      subtitle: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
      createdAt: new Date().toISOString(),
      accent: job.platform === 'youtube' ? 'lavender' : 'mint',
    };
    const next = [item, ...this.recent()].slice(0, 12);
    this.recent.set(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  private loadRecent(): RecentItem[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as RecentItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveFileToDevice(href: string, filename: string): Promise<void> {
    if (href.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.click();
      return;
    }
    const full = href.startsWith('http') ? href : `${this.api.apiBaseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
    const res = await fetch(full);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
