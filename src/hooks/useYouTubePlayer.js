import { useEffect, useRef, useState } from 'react';

export function useYouTubePlayer(videoId, volume, startSeconds = 0) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function loadPlayer() {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          start: startSeconds || 0,
        },
        events: {
          onReady: () => {
            playerRef.current?.setVolume?.(volume);
            setReady(true);
          },
          onStateChange: (event) => setPlaying(event.data === window.YT.PlayerState.PLAYING),
        },
      });
    }

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      loadPlayer();
    };

    if (window.YT?.Player) loadPlayer();

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    playerRef.current?.loadVideoById?.({ videoId, startSeconds: startSeconds || 0 });
    playerRef.current?.setVolume?.(volume);
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
