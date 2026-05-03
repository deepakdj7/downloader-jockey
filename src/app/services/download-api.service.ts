import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { CreateJobResponse, JobStatusResponse, YoutubeFormat } from '../models/download.models';
import { PreviewMeta } from '../models/preview.models';

const STORAGE_KEY = 'downloaderJockeyApiBaseUrl';

@Injectable({
  providedIn: 'root',
})
export class DownloadApiService {
  constructor(private readonly http: HttpClient) {}

  /** Persisted override when production env api URL is empty (e.g. GitHub Pages). */
  getStoredApiBaseUrl(): string {
    if (typeof localStorage === 'undefined') return '';
    return (localStorage.getItem(STORAGE_KEY) ?? '').trim();
  }

  setStoredApiBaseUrl(url: string): void {
    if (typeof localStorage === 'undefined') return;
    const v = url.trim().replace(/\/$/, '');
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  }

  /** API origin (no trailing slash): env in development; prod env or saved URL from ⋯ settings. */
  get apiBaseUrl(): string {
    const fromEnv = (environment.apiBaseUrl ?? '').trim().replace(/\/$/, '');
    if (!environment.production && fromEnv) return fromEnv;
    if (!environment.production && !fromEnv) return '';
    if (fromEnv) return fromEnv;
    return this.getStoredApiBaseUrl().replace(/\/$/, '');
  }

  /** YouTube companion (yt-dlp) — required for YouTube preview/download only. */
  hasYoutubeApiConfigured(): boolean {
    return this.apiBaseUrl.length > 0;
  }

  /** Preview metadata via yt-dlp (YouTube URLs only). */
  previewYoutube(url: string): Observable<PreviewMeta> {
    return this.http.post<PreviewMeta>(`${this.apiBaseUrl}/api/preview`, { url: url.trim() });
  }

  createJob(url: string, youtubeFormat: YoutubeFormat): Observable<CreateJobResponse> {
    return this.http.post<CreateJobResponse>(`${this.apiBaseUrl}/api/jobs`, {
      url,
      youtubeFormat,
    });
  }

  getJob(jobId: string): Observable<JobStatusResponse> {
    return this.http.get<JobStatusResponse>(`${this.apiBaseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
  }

  absoluteFileUrl(href: string): string {
    if (href.startsWith('http')) return href;
    return `${this.apiBaseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
  }

  /** Ping API health (optional). */
  healthCheck(): Observable<boolean> {
    if (!this.hasYoutubeApiConfigured()) {
      return of(false);
    }
    return this.http.get(`${this.apiBaseUrl}/api/health`, { responseType: 'text' }).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }
}
