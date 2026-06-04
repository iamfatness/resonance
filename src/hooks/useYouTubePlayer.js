import { useEffect, useRef, useState } from 'react';
import { loadYouTubeIframeApi } from '../platform/youtubeIframeApi.js';

export function useYouTubePlayer(videoId, volume, startSeconds = 0) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const initialVideoRef = useRef({ videoId, volume, startSeconds });
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setReady(false);
    setPlaying(false);

    loadYouTubeIframeApi().then((yt) => {
      if (cancelled || !containerRef.current) return;
      const initialVideo = initialVideoRef.current;
      playerRef.current = new yt.Player(containerRef.current, {
        videoId: initialVideo.videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          start: initialVideo.startSeconds || 0,
        },
        events: {
          onReady: () => {
            playerRef.current?.setVolume?.(initialVideo.volume);
            setReady(true);
          },
          onStateChange: (event) => setPlaying(event.data === yt.PlayerState.PLAYING),
        },
      });
    }).catch((error) => {
      if (!cancelled) console.error(error);
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    playerRef.current?.loadVideoById?.({ videoId, startSeconds: startSeconds || 0 });
  }, [ready, videoId, startSeconds]);

  useEffect(() => {
    if (!ready) return;
    playerRef.current?.setVolume?.(volume);
    if (volume === 0) playerRef.current?.mute?.();
    else playerRef.current?.unMute?.();
  }, [ready, volume]);

  return {
    containerRef,
    ready,
    playing,
    toggle: () => {
      if (!ready) return;
      if (playing) playerRef.current.pauseVideo();
      else playerRef.current.playVideo();
    },
    play: () => ready && playerRef.current?.playVideo?.(),
    pause: () => ready && playerRef.current?.pauseVideo?.(),
  };
}
