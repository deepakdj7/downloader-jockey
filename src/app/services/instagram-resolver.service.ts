import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PreviewMeta } from '../models/preview.models';
import { InstagramResolveResponse } from '../models/instagram.models';

const STORAGE_KEY = 'downloaderJockeyInstagramResolverUrl';

/**
 * GitHub Pages cannot scrape Instagram. The PWA calls **your** HTTPS resolver
 * (Cloudflare Worker, Edge Function, etc.) that returns direct media URLs with CORS if needed.
 */
@Injectable({
  providedIn: 'root',
})
export class InstagramResolverService {
  constructor(private readonly http: HttpClient) {}

  getStoredBaseUrl(): string {
    if (typeof localStorage === 'undefined') return '';
    return (localStorage.getItem(STORAGE_KEY) ?? '').trim();
  }

  setStoredBaseUrl(url: string): void {
    if (typeof localStorage === 'undefined') return;
    const v = url.trim().replace(/\/$/, '');
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  }

  /** Resolver origin only (no trailing slash). */
  get baseUrl(): string {
    const fromEnv = (environment.instagramResolverUrl ?? '').trim().replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    return this.getStoredBaseUrl().replace(/\/$/, '');
  }

  hasResolver(): boolean {
    return this.baseUrl.length > 0;
  }

  /** Metadata only (title, thumbnail, description). */
  preview(url: string): Observable<PreviewMeta> {
    return this.http.post<PreviewMeta>(`${this.baseUrl}/api/instagram/preview`, {
      url: url.trim(),
    });
  }

  /** Direct media URLs for client-side fetch + save. */
  resolve(url: string): Observable<InstagramResolveResponse> {
    return this.http.post<InstagramResolveResponse>(`${this.baseUrl}/api/instagram/resolve`, {
      url: url.trim(),
    });
  }
}
