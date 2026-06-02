import { defineConfig } from 'vite';

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalizeSearchItem(item) {
  const videoId = item?.id?.videoId;
  const snippet = item?.snippet || {};
  if (!videoId) return null;

  return {
    id: videoId,
    title: snippet.title || 'Untitled YouTube video',
    channel: snippet.channelTitle || 'YouTube',
    duration: '--:--',
    thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    publishedAt: snippet.publishedAt || null,
  };
}

async function handleYouTubeSearch(req, res) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    sendJson(res, 501, { error: 'YouTube search is not configured locally. Set YOUTUBE_API_KEY before running npm run dev.' });
    return;
  }

  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const query = requestUrl.searchParams.get('q')?.trim();
  if (!query) {
    sendJson(res, 400, { error: 'Missing search query.' });
    return;
  }

  const limit = Math.max(1, Math.min(Number(requestUrl.searchParams.get('limit')) || 8, 12));
  const youtubeUrl = new URL(YOUTUBE_SEARCH_URL);
  youtubeUrl.searchParams.set('part', 'snippet');
  youtubeUrl.searchParams.set('type', 'video');
  youtubeUrl.searchParams.set('maxResults', String(limit));
  youtubeUrl.searchParams.set('safeSearch', 'none');
  youtubeUrl.searchParams.set('q', query);
  youtubeUrl.searchParams.set('key', apiKey);

  const response = await fetch(youtubeUrl);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    sendJson(res, response.status, { error: data?.error?.message || 'YouTube search failed.' });
    return;
  }

  sendJson(res, 200, {
    items: (data.items || []).map(normalizeSearchItem).filter(Boolean),
  });
}

export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  plugins: [{
    name: 'resonance-youtube-search-api',
    configureServer(server) {
      server.middlewares.use('/api/youtube/search', (req, res) => {
        handleYouTubeSearch(req, res).catch((error) => {
          sendJson(res, 500, { error: error?.message || 'YouTube search failed.' });
        });
      });
    },
  }],
});
