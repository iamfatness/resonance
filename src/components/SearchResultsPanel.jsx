export function SearchResultsPanel({
  searchState,
  results,
  targetDeck,
  onClear,
  onLoadVideo,
  onQueueVideo,
}) {
  if (searchState.status === 'idle') return null;

  return (
    <section className={`youtube-search-panel ${searchState.status}`} aria-live="polite">
      <div className="youtube-search-status">
        <span>{searchState.message}</span>
        {searchState.status !== 'loading' && (
          <button type="button" onClick={onClear} aria-label="Clear YouTube search results">
            Clear
          </button>
        )}
      </div>
      {results.length > 0 && (
        <div className="youtube-result-list">
          {results.map((video) => (
            <article className="youtube-result" key={video.id}>
              <img alt="" src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} />
              <span>
                <strong>{video.title}</strong>
                <small>
                  {video.channel} · {video.duration || '--:--'}
                </small>
              </span>
              <div className="youtube-result-actions">
                <button type="button" onClick={() => onLoadVideo(video, targetDeck)}>
                  Load Deck {targetDeck}
                </button>
                <button type="button" onClick={() => onQueueVideo(video, 'next')}>
                  Play next
                </button>
                <button type="button" onClick={() => onQueueVideo(video)}>
                  Queue
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
