import { Injectable } from '@angular/core';
import { DownloadPlatform } from '../models/download.models';

@Injectable({
  providedIn: 'root',
})
export class PlatformDetectorService {
  detect(urlText: string): DownloadPlatform {
    const t = urlText.trim();
    if (!t) return 'unknown';
    try {
      const u = new URL(t.includes('://') ? t : `https://${t}`);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
        return 'youtube';
      }
      if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
        return 'instagram';
      }
    } catch {
      return 'unknown';
    }
    return 'unknown';
  }

  isYoutubeShort(urlText: string): boolean {
    try {
      const u = new URL(urlText.includes('://') ? urlText : `https://${urlText}`);
      return u.pathname.includes('/shorts/');
    } catch {
      return false;
    }
  }
}
