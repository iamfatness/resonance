let iframeApiPromise;

export function loadYouTubeIframeApi() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube iframe API requires a browser window.'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (iframeApiPromise) {
    return iframeApiPromise;
  }

  iframeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve(window.YT);
    };

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existingScript) {
      existingScript.addEventListener('error', () => reject(new Error('YouTube iframe API failed to load.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('YouTube iframe API failed to load.'));
    document.head.appendChild(script);
  });

  return iframeApiPromise;
}
