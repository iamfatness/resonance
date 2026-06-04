export const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
export const YOUTUBE_PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';
export const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

export function normalizeSearchItem(item) {
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

export function normalizePlaylistItem(item) {
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

export function formatIsoDuration(duration) {
  const match = duration?.match?.(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return '--:--';

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0) + (days * 24);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const parts = hours > 0
    ? [hours, String(minutes).padStart(2, '0'), String(seconds).padStart(2, '0')]
    : [minutes, String(seconds).padStart(2, '0')];
  return parts.join(':');
}

export async function fetchVideoMetadata(items, apiKey, fetcher = fetch) {
  const ids = [...new Set(items.map((item) => item.id).filter(Boolean))];
  if (!ids.length) return items;

  const youtubeUrl = new URL(YOUTUBE_VIDEOS_URL);
  youtubeUrl.searchParams.set('part', 'contentDetails,status,snippet,liveStreamingDetails');
  youtubeUrl.searchParams.set('id', ids.join(','));
  youtubeUrl.searchParams.set('key', apiKey);

  const response = await fetcher(youtubeUrl);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return items;

  const metadataById = new Map((data.items || []).map((item) => [item.id, item]));
  return items.map((item) => {
    const metadata = metadataById.get(item.id);
    if (!metadata) return item;

    const liveStatus = metadata.snippet?.liveBroadcastContent || 'none';
    return {
      ...item,
      title: item.title || metadata.snippet?.title || 'Untitled YouTube video',
      channel: metadata.snippet?.channelTitle || item.channel,
      duration: liveStatus !== 'none' ? liveStatus : formatIsoDuration(metadata.contentDetails?.duration),
      embeddable: metadata.status?.embeddable ?? null,
      liveStatus,
    };
  });
}
