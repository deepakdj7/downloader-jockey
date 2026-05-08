import {
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  of,
  EMPTY,
  catchError,
  tap,
  mergeMap,
  from,
} from 'rxjs';
import { DownloadQueueService } from '../../services/download-queue.service';
import { PlatformDetectorService } from '../../services/platform-detector.service';
import { DownloadApiService } from '../../services/download-api.service';
import { InstagramResolverService } from '../../services/instagram-resolver.service';
import { InstagramAuthService } from '../../services/instagram-auth.service';
import { DownloadJob, YoutubeFormat } from '../../models/download.models';
import { PreviewMeta } from '../../models/preview.models';
import { getHttpErrorMessage } from '../../utils/http-error.util';

export interface PreviewRow {
  key: string;
  url: string;
  title: string;
  description: string;
  thumbnail?: string;
  loading: boolean;
  error?: string;
  jobId?: string;
}

@Component({
  selector: 'app-downloads',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './downloads.component.html',
  styleUrl: './downloads.component.scss',
})
export class DownloadsComponent {
  readonly queue = inject(DownloadQueueService);
  readonly platform = inject(PlatformDetectorService);
  readonly api = inject(DownloadApiService);
  readonly ig = inject(InstagramResolverService);
  readonly igAuth = inject(InstagramAuthService);
  urlInput = '';
  ytFormat: YoutubeFormat = 'video';
  apiUrlInput = '';
  instagramUrlInput = '';
  showApiPanel = signal(false);
  toast = signal<string | null>(null);

  /** Single-URL preview (right panel when not in batch mode). */
  singlePreview = signal<{
    loading: boolean;
    error?: string;
    meta?: PreviewMeta;
  } | null>(null);

  /** JSON list mode: one row per URL. */
  batchRows = signal<PreviewRow[]>([]);
  jsonFileName = signal<string | null>(null);

  /** Active download job id for the single-URL flow (right-panel progress). */
  singleJobId = signal<string | null>(null);

  showIgAuth = signal(false);
  igLoginUser = '';
  igLoginPass = '';
  igAuthBusy = signal(false);
  igAuthError = signal<string | null>(null);
  /** Show password characters in the Instagram login modal (tab-only UI state). */
  igShowPassword = signal(false);

  readonly batchMode = computed(() => this.batchRows().length > 0);

  readonly previewMeta = computed(() => this.singlePreview()?.meta ?? null);

  private readonly urlSubject = new Subject<string>();

  constructor() {
    this.apiUrlInput = this.api.getStoredApiBaseUrl();
    this.instagramUrlInput = this.ig.getStoredBaseUrl();
    if (!this.api.hasYoutubeApiConfigured() && !this.ig.hasResolver()) {
      this.showApiPanel.set(true);
    }

    this.igAuth.refreshStatus().subscribe();

    this.urlSubject
      .pipe(
        debounceTime(450),
        distinctUntilChanged(),
        switchMap((text) => {
          if (this.batchMode()) {
            return EMPTY;
          }
          const t = text.trim();
          if (t.length < 12) {
            this.singleJobId.set(null);
            this.singlePreview.set(null);
            return EMPTY;
          }
          const plat = this.platform.detect(t);
          if (plat === 'unknown') {
            this.singleJobId.set(null);
            this.singlePreview.set(null);
            return EMPTY;
          }
          if (plat === 'youtube' && !this.api.hasYoutubeApiConfigured()) {
            this.singleJobId.set(null);
            this.singlePreview.set({
              loading: false,
              error:
                'YouTube needs the companion API. Tap ⋯ and set “YouTube API base URL” (local: http://localhost:3847 after npm start in server/).',
            });
            return EMPTY;
          }
          if (plat === 'instagram' && !this.ig.hasResolver()) {
            this.singleJobId.set(null);
            this.showApiPanel.set(true);
            this.singlePreview.set({
              loading: false,
              error:
                'Set the Instagram API URL under ⋯ (local: http://localhost:3848 — run npm run start:ig-api or npm run start:all).',
            });
            return EMPTY;
          }
          this.singleJobId.set(null);
          this.singlePreview.set({ loading: true });
          const preview$ =
            plat === 'instagram'
              ? this.ig.preview(t)
              : this.api.previewYoutube(t);
          return preview$.pipe(
            tap((meta) => this.singlePreview.set({ loading: false, meta })),
            catchError((err) => {
              this.singlePreview.set({
                loading: false,
                error: getHttpErrorMessage(err, 'Preview failed'),
              });
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  onUrlChange(value: string): void {
    if (this.batchRows().length > 0) {
      this.clearBatch();
    }
    this.urlSubject.next(value);
  }

  toggleApi(): void {
    this.showApiPanel.update((v) => !v);
  }

  saveApiUrl(): void {
    this.api.setStoredApiBaseUrl(this.apiUrlInput);
    this.ig.setStoredBaseUrl(this.instagramUrlInput);
    this.toast.set('Settings saved.');
    setTimeout(() => this.toast.set(null), 2400);
    this.urlSubject.next(this.urlInput);
    this.igAuth.refreshStatus().subscribe();
  }

  openIgAuth(): void {
    this.igAuthError.set(null);
    this.igShowPassword.set(false);
    this.showIgAuth.set(true);
    this.igAuth.refreshStatus().subscribe();
  }

  closeIgAuth(): void {
    this.showIgAuth.set(false);
    this.igLoginPass = '';
    this.igAuthError.set(null);
    this.igShowPassword.set(false);
  }

  toggleIgPasswordVisible(): void {
    this.igShowPassword.update((v) => !v);
  }

  submitIgLogin(): void {
    if (!this.ig.hasResolver()) {
      this.igAuthError.set('Set the Instagram API URL under ⋯ (e.g. http://localhost:3848) first.');
      return;
    }
    const u = this.igLoginUser.trim();
    if (!u || !this.igLoginPass) {
      this.igAuthError.set('Enter username and password.');
      return;
    }
    this.igAuthBusy.set(true);
    this.igAuthError.set(null);
    this.igAuth.login(u, this.igLoginPass).subscribe({
      next: () => {
        this.igLoginPass = '';
        this.igAuthBusy.set(false);
        this.closeIgAuth();
        this.toast.set('Instagram session is active on the API (this machine).');
        setTimeout(() => this.toast.set(null), 3000);
      },
      error: (err) => {
        this.igAuthBusy.set(false);
        this.igAuthError.set(getHttpErrorMessage(err, 'Login failed'));
      },
    });
  }

  onIgLogout(): void {
    this.igAuthBusy.set(true);
    this.igAuth.logout().subscribe({
      next: () => {
        this.igAuthBusy.set(false);
        this.toast.set('Instagram session cleared on the API.');
        setTimeout(() => this.toast.set(null), 2800);
        this.closeIgAuth();
      },
      error: () => {
        this.igAuthBusy.set(false);
      },
    });
  }

  get detected() {
    return this.platform.detect(this.urlInput);
  }

  onJsonSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.jsonFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = JSON.parse(text) as unknown;
        const urls = this.extractUrlsFromJson(parsed);
        if (urls.length === 0) {
          this.toast.set('No URLs found in JSON.');
          setTimeout(() => this.toast.set(null), 3200);
          return;
        }
        this.urlInput = '';
        this.singleJobId.set(null);
        this.singlePreview.set(null);
        this.batchRows.set(
          urls.map((url) => ({
            key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            url,
            title: '',
            description: '',
            loading: true,
          })),
        );
        this.fetchBatchPreviews();
      } catch {
        this.toast.set('Invalid JSON file.');
        setTimeout(() => this.toast.set(null), 3200);
      }
    };
    reader.readAsText(file);
  }

  private extractUrlsFromJson(parsed: unknown): string[] {
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const keys = ['urls', 'links', 'items'];
      for (const k of keys) {
        const arr = o[k];
        if (Array.isArray(arr)) {
          const out: string[] = [];
          for (const item of arr) {
            if (typeof item === 'string') out.push(item);
            else if (item && typeof item === 'object' && typeof (item as { url?: string }).url === 'string') {
              out.push((item as { url: string }).url);
            }
          }
          return out.filter((u) => u.trim().length > 0);
        }
      }
    }
    return [];
  }

  private fetchBatchPreviews(): void {
    const rows = this.batchRows();
    from(rows)
      .pipe(
        mergeMap((row) => {
          const plat = this.platform.detect(row.url);
          if (plat === 'instagram' && !this.ig.hasResolver()) {
            return of(null).pipe(
              tap(() =>
                this.patchRow(row.key, {
                  loading: false,
                  error: 'Set Instagram resolver URL.',
                  title: row.url,
                }),
              ),
            );
          }
          if (plat === 'youtube' && !this.api.hasYoutubeApiConfigured()) {
            return of(null).pipe(
              tap(() =>
                this.patchRow(row.key, {
                  loading: false,
                  error: 'Set YouTube API URL.',
                  title: row.url,
                }),
              ),
            );
          }
          if (plat === 'unknown') {
            return of(null).pipe(
              tap(() =>
                this.patchRow(row.key, {
                  loading: false,
                  error: 'Unsupported URL',
                  title: row.url,
                }),
              ),
            );
          }
          const req =
            plat === 'instagram'
              ? this.ig.preview(row.url)
              : this.api.previewYoutube(row.url);
          return req.pipe(
            tap((meta) => {
              this.patchRow(row.key, {
                loading: false,
                title: meta.title,
                description: meta.description,
                thumbnail: meta.thumbnail,
                error: undefined,
              });
            }),
            catchError((err) => {
              this.patchRow(row.key, {
                loading: false,
                title: row.title || row.url,
                error: getHttpErrorMessage(err, 'Preview failed'),
              });
              return of(null);
            }),
          );
        }, 4),
      )
      .subscribe();
  }

  clearBatch(): void {
    this.batchRows.set([]);
    this.jsonFileName.set(null);
  }

  primaryDownload(): void {
    if (this.batchMode()) {
      this.downloadAll();
      return;
    }
    const gate = this.queue.canStart(this.urlInput);
    if (!gate.ok) {
      this.toast.set(gate.message);
      setTimeout(() => this.toast.set(null), 3200);
      return;
    }
    const title = this.singlePreview()?.meta?.title;
    const res = this.queue.addFromUrl(this.urlInput.trim(), this.ytFormat, title);
    if (!res.ok) {
      this.toast.set(res.message);
      setTimeout(() => this.toast.set(null), 3200);
      return;
    }
    this.singleJobId.set(res.id);
  }

  downloadAll(): void {
    for (const row of this.batchRows()) {
      const g = this.queue.canStart(row.url);
      if (!g.ok) {
        this.toast.set(g.message);
        setTimeout(() => this.toast.set(null), 3200);
        return;
      }
    }
    for (const row of this.batchRows()) {
      const label = row.title?.trim() || row.url;
      const res = this.queue.addFromUrl(row.url, this.ytFormat, label);
      if (res.ok) {
        this.patchRow(row.key, { jobId: res.id });
      }
    }
  }

  private patchRow(key: string, partial: Partial<PreviewRow>): void {
    this.batchRows.update((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...partial } : r)),
    );
  }

  jobFor(id?: string | null): DownloadJob | undefined {
    if (!id) return undefined;
    return this.queue.jobs().find((j) => j.id === id);
  }

  platformLabel(job: DownloadJob): string {
    if (job.platform === 'youtube') {
      return job.youtubeFormat === 'mp3' ? 'MP3' : 'MP4';
    }
    return 'IG';
  }

  trackDetail(job: DownloadJob): string {
    if (job.status === 'complete' && job.files.length > 1) {
      return `${job.files.length} files`;
    }
    if (job.detail) return job.detail;
    if (job.status === 'error') return job.errorMessage ?? 'Something went wrong';
    return 'Preparing…';
  }

  async downloadOne(job: DownloadJob, href: string, name: string): Promise<void> {
    try {
      await this.queue.saveFileToDevice(href, name);
    } catch (e) {
      this.toast.set(String((e as Error)?.message ?? e));
      setTimeout(() => this.toast.set(null), 3200);
    }
  }

  canPrimaryDownload(): boolean {
    if (this.batchMode()) {
      return this.batchRows().length > 0;
    }
    const t = this.urlInput.trim();
    if (t.length <= 10 || this.platform.detect(t) === 'unknown') return false;
    const p = this.platform.detect(t);
    if (p === 'youtube') return this.api.hasYoutubeApiConfigured();
    if (p === 'instagram') return this.ig.hasResolver();
    return false;
  }
}
