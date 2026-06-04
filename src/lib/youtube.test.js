import { describe, expect, it } from 'vitest';
import {
  isYoutubeLoadInput,
  parseYoutubeId,
  parseYoutubePlaylistId,
  parseYoutubeTimestamp,
  youtubeUrlForVideo,
} from './youtube.js';

describe('YouTube helpers', () => {
  it('parses common YouTube video inputs', () => {
    expect(parseYoutubeId('JD-kMIpDfnY')).toBe('JD-kMIpDfnY');
    expect(parseYoutubeId('https://www.youtube.com/watch?v=JD-kMIpDfnY')).toBe('JD-kMIpDfnY');
    expect(parseYoutubeId('https://youtu.be/JD-kMIpDfnY?t=12')).toBe('JD-kMIpDfnY');
    expect(parseYoutubeId('https://www.youtube.com/shorts/JD-kMIpDfnY')).toBe('JD-kMIpDfnY');
    expect(parseYoutubeId('https://www.youtube.com/embed/JD-kMIpDfnY')).toBe('JD-kMIpDfnY');
  });

  it('parses playlist IDs only from YouTube URLs', () => {
    expect(parseYoutubePlaylistId('https://www.youtube.com/playlist?list=PL123')).toBe('PL123');
    expect(parseYoutubePlaylistId('https://example.com/?list=PL123')).toBeNull();
  });

  it('parses timestamp formats', () => {
    expect(parseYoutubeTimestamp('https://www.youtube.com/watch?v=JD-kMIpDfnY&t=7284s')).toBe(7284);
    expect(parseYoutubeTimestamp('https://www.youtube.com/watch?v=JD-kMIpDfnY&t=1h2m3s')).toBe(3723);
    expect(parseYoutubeTimestamp('not a url')).toBe(0);
  });

  it('formats videos back to watch URLs', () => {
    expect(youtubeUrlForVideo({ id: 'JD-kMIpDfnY', startSeconds: 10 })).toBe(
      'https://www.youtube.com/watch?v=JD-kMIpDfnY&t=10s',
    );
    expect(isYoutubeLoadInput('lofi hip hop')).toBe(false);
  });
});
