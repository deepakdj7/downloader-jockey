/**
 * Rename to worker entry + wire in wrangler.toml.
 * Set secrets / vars for your real extraction logic — this only shows CORS + routing.
 */

const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const base = { ...cors(origin), ...JSON_HDR };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (path === '/api/instagram/preview' && request.method === 'POST') {
      const { url: igUrl } = await request.json();
      // TODO: resolve preview via your backend / upstream API using env secrets.
      return new Response(
        JSON.stringify({
          url: igUrl,
          title: 'Configure worker',
          description: 'Implement extraction and return real metadata.',
          thumbnail: '',
        }),
        { headers: base },
      );
    }

    if (path === '/api/instagram/resolve' && request.method === 'POST') {
      const { url: igUrl } = await request.json();
      // TODO: return { items: [{ url, filename }, …] } with CORS-fetchable URLs (or proxy streams).
      return new Response(
        JSON.stringify({
          error:
            'Replace this stub: return items[].url that the browser can fetch (same-origin proxy recommended).',
          items: [],
        }),
        { status: 501, headers: base },
      );
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: base,
    });
  },
};
