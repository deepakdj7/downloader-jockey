/**
 * Extract a user-visible message from HttpClient failures.
 * FastAPI uses `{ "detail": "…" }`; Express may use `{ "error": "…" }`.
 */
export function getHttpErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (err && typeof err === 'object') {
    const e = err as { error?: unknown; message?: string };
    const body = e.error;
    if (body && typeof body === 'object') {
      const b = body as { detail?: unknown; error?: unknown; message?: string };
      if (typeof b.detail === 'string' && b.detail.length) {
        return b.detail;
      }
      if (Array.isArray(b.detail) && b.detail.length) {
        const first = b.detail[0] as { msg?: string } | string;
        if (typeof first === 'string') {
          return first;
        }
        if (first && typeof first === 'object' && 'msg' in first) {
          return String((first as { msg: string }).msg);
        }
      }
      if (typeof b.error === 'string' && b.error.length) {
        return b.error;
      }
      if (typeof b.message === 'string' && b.message.length) {
        return b.message;
      }
    }
    if (typeof e.message === 'string' && e.message.length) {
      return e.message;
    }
  }
  return fallback;
}
