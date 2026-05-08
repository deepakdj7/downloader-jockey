import { Injectable, inject, signal, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { InstagramResolverService } from './instagram-resolver.service';

/** Set only after a successful lock-dialog login; used to log out the API when this tab closes. */
const UI_TAB_SESSION_KEY = 'downloaderJockeyIgUiSession';

export interface InstagramAuthStatus {
  loggedIn: boolean;
  username: string | null;
}

/**
 * Instagram session on the **Python API** (in-memory). Password is never stored — only sent once on login.
 * After a **UI** login, closing this browser tab sends `logout` (`keepalive`) so the server session ends with the tab.
 */
@Injectable({
  providedIn: 'root',
})
export class InstagramAuthService {
  private readonly http = inject(HttpClient);
  private readonly resolver = inject(InstagramResolverService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  /** Set after refreshStatus; `checked` means we attempted at least once. */
  readonly authState = signal<{
    checked: boolean;
    loggedIn: boolean;
    username: string | null;
  }>({ checked: false, loggedIn: false, username: null });

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const onPageHide = (ev: PageTransitionEvent) => {
      if (ev.persisted) {
        return;
      }
      if (sessionStorage.getItem(UI_TAB_SESSION_KEY) !== '1') {
        return;
      }
      // Don't clear the API session on full-page reload (same tab keeps sessionStorage).
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      const legacy = (performance as unknown as { navigation?: { type?: number } }).navigation;
      const isReload =
        nav?.type === 'reload' || (legacy?.type === 1); // 1 === TYPE_RELOAD
      if (isReload) {
        return;
      }
      const base = this.origin();
      if (!base) {
        return;
      }
      void fetch(`${base}/api/instagram/auth/logout`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onPageHide as EventListener);
    this.destroyRef.onDestroy(() => window.removeEventListener('pagehide', onPageHide as EventListener));
  }

  private origin(): string | null {
    const o = this.resolver.baseUrl?.trim().replace(/\/$/, '');
    return o || null;
  }

  refreshStatus(): Observable<void> {
    const base = this.origin();
    if (!base) {
      this.authState.set({ checked: true, loggedIn: false, username: null });
      return of(undefined);
    }
    return this.http.get<InstagramAuthStatus>(`${base}/api/instagram/auth/status`).pipe(
      tap((res) =>
        this.authState.set({
          checked: true,
          loggedIn: !!res.loggedIn,
          username: res.username ?? null,
        }),
      ),
      map(() => undefined),
      catchError(() => {
        this.authState.set({ checked: true, loggedIn: false, username: null });
        return of(undefined);
      }),
    );
  }

  login(username: string, password: string): Observable<void> {
    const base = this.origin();
    if (!base) {
      throw new Error('Instagram API URL not configured');
    }
    const u = username.trim();
    const p = password;
    return this.http
      .post<{ ok: boolean; username?: string }>(`${base}/api/instagram/auth/login`, {
        username: u,
        password: p,
      })
      .pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          sessionStorage.setItem(UI_TAB_SESSION_KEY, '1');
        }
        this.authState.set({
          checked: true,
          loggedIn: true,
          username: u,
        });
      }),
      map(() => undefined),
    );
  }

  logout(): Observable<void> {
    const base = this.origin();
    if (!base) {
      if (isPlatformBrowser(this.platformId)) {
        sessionStorage.removeItem(UI_TAB_SESSION_KEY);
      }
      this.authState.set({ checked: true, loggedIn: false, username: null });
      return of(undefined);
    }
    return this.http.post<{ ok: boolean }>(`${base}/api/instagram/auth/logout`, {}).pipe(
      tap(() => {
        if (isPlatformBrowser(this.platformId)) {
          sessionStorage.removeItem(UI_TAB_SESSION_KEY);
        }
        this.authState.set({
          checked: true,
          loggedIn: false,
          username: null,
        });
      }),
      map(() => undefined),
      catchError(() => {
        if (isPlatformBrowser(this.platformId)) {
          sessionStorage.removeItem(UI_TAB_SESSION_KEY);
        }
        this.authState.set({ checked: true, loggedIn: false, username: null });
        return of(undefined);
      }),
    );
  }
}
