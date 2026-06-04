import { describe, expect, it, vi } from 'vitest';
import {
  fetchVideoMetadata,
  formatIsoDuration,
  normalizePlaylistItem,
  normalizeSearchItem,
} from './youtubeApi.js';

describe('YouTube API normalization', () => {
  it('normalizes search results with thumbnail fallback', () => {
    expect(normalizeSearchItem({
      id: { videoId: 'abc123' },
      snippet: {
        title: 'Result',
        channelTitle: 'Channel',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnails: {},
      },
    })).toEqual({
      id: 'abc123',
      title: 'Result',
      channel: 'Channel',
      duration: '--:--',
      thumbnail: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    expect(normalizeSearchItem({ id: {}, snippet: {} })).toBeNull();
  });

  it('normalizes playlist items and filters unavailable videos', () => {
    expect(normalizePlaylistItem({
      snippet: {
        resourceId: { videoId: 'playlist-video' },
        title: 'Playlist Video',
        videoOwnerChannelTitle: 'Owner',
        thumbnails: { medium: { url: 'https://thumb.test/image.jpg' } },
      },
    })).toMatchObject({
      id: 'playlist-video',
      title: 'Playlist Video',
      channel: 'Owner',
      thumbnail: 'https://thumb.test/image.jpg',
    });
    expect(normalizePlaylistItem({ snippet: { title: 'Deleted video', resourceId: { videoId: 'x' } } })).toBeNull();
    expect(normalizePlaylistItem({ snippet: { title: 'Private video', resourceId: { videoId: 'x' } } })).toBeNull();
  });

  it('formats ISO 8601 YouTube durations', () => {
    expect(formatIsoDuration('PT3M7S')).toBe('3:07');
    expect(formatIsoDuration('PT1H2M3S')).toBe('1:02:03');
    expect(formatIsoDuration('P1DT2M3S')).toBe('24:02:03');
    expect(formatIsoDuration('not a duration')).toBe('--:--');
  });

  it('enriches videos with fetched metadata', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [{
          id: 'abc123',
          snippet: { channelTitle: 'Metadata Channel', liveBroadcastContent: 'none' },
          contentDetails: { duration: 'PT4M5S' },
          status: { embeddable: true },
        }],
      }),
    }));

    await expect(fetchVideoMetadata([{ id: 'abc123', title: 'Original', channel: 'Original Channel' }], 'key', fetcher))
      .resolves.toEqual([{
        id: 'abc123',
        title: 'Original',
        channel: 'Metadata Channel',
        duration: '4:05',
        embeddable: true,
        liveStatus: 'none',
      }]);
  });
});
