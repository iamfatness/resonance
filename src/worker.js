const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
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

function normalizePlaylistItem(item) {
  const snippet = item?.snippet || {};
  const videoId = snippet.resourceId?.videoId;
  if (!videoId || snippet.title === 'Deleted video' || snippet.title === 'Private video') return null;

  return {
    id: videoId,
    title: snippet.title || 'Untitled YouTube video',
    channel: snippet.videoOwnerChannelTitle || snippet.channelTitle || 'YouTube',
    duration: '--:--',
    thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    publishedAt: snippet.publishedAt || null,
  };
}

function getApiKey(env) {
  return env.YOUTUBE_API_KEY;
}

async function searchYouTube(request, env) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    return jsonResponse({ error: 'YouTube search is not configured. Set the YOUTUBE_API_KEY secret on the Worker.' }, { status: 501 });
  }

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get('q')?.trim();
  if (!query) {
    return jsonResponse({ error: 'Missing search query.' }, { status: 400 });
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
    const message = data?.error?.message || 'YouTube search failed.';
    return jsonResponse({ error: message }, { status: response.status });
  }

  return jsonResponse({
    items: (data.items || []).map(normalizeSearchItem).filter(Boolean),
  });
}

async function importYouTubePlaylist(request, env) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    return jsonResponse({ error: 'YouTube playlist import is not configured. Set the YOUTUBE_API_KEY secret on the Worker.' }, { status: 501 });
  }

  const requestUrl = new URL(request.url);
  const playlistId = requestUrl.searchParams.get('list')?.trim();
  if (!playlistId) {
    return jsonResponse({ error: 'Missing YouTube playlist ID.' }, { status: 400 });
  }

  const limit = Math.max(1, Math.min(Number(requestUrl.searchParams.get('limit')) || 25, 50));
  const youtubeUrl = new URL(YOUTUBE_PLAYLIST_ITEMS_URL);
  youtubeUrl.searchParams.set('part', 'snippet');
  youtubeUrl.searchParams.set('playlistId', playlistId);
  youtubeUrl.searchParams.set('maxResults', String(limit));
  youtubeUrl.searchParams.set('key', apiKey);

  const response = await fetch(youtubeUrl);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || 'YouTube playlist import failed.';
    return jsonResponse({ error: message }, { status: response.status });
  }

  return jsonResponse({
    title: data.items?.[0]?.snippet?.channelTitle ? 'Imported Playlist' : 'Imported Playlist',
    items: (data.items || []).map(normalizePlaylistItem).filter(Boolean),
    nextPageToken: data.nextPageToken || null,
  });
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/youtube/search') {
      return searchYouTube(request, env);
    }
    if (url.pathname === '/api/youtube/playlist') {
      return importYouTubePlaylist(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
