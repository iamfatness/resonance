export function parseYoutubeId(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.includes('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shorts) return shorts[1];
      const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embed) return embed[1];
    }
  } catch {
    return null;
  }
  return null;
}

export function parseYoutubeTimestamp(value) {
  try {
    const url = new URL(value);
    const timestamp = url.searchParams.get('t') || url.searchParams.get('start');
    if (!timestamp) return 0;
    if (/^\d+$/.test(timestamp)) return Number(timestamp);
    const match = timestamp.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (!match) return 0;
    return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
  } catch {
    return 0;
  }
}

export function parseYoutubePlaylistId(value) {
  try {
    const url = new URL(value.trim());
    if (!url.hostname.includes('youtube.com') && !url.hostname.includes('youtu.be')) return null;
    return url.searchParams.get('list');
  } catch {
    return null;
  }
}

export function youtubeUrlForVideo(video) {
  const url = `https://www.youtube.com/watch?v=${video.id}`;
  return video.startSeconds ? `${url}&t=${video.startSeconds}s` : url;
}

export function isYoutubeLoadInput(value) {
  return Boolean(parseYoutubeId(value));
}
