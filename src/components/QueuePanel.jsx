import { ArrowRight, ListMusic, SkipForward, SlidersHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';

export function QueuePanel({
  activePreset,
  isSingleDeck,
  selectedPlaylist,
  preset,
  activeVideoLiked,
  activeVideo,
  toggleLikedVideo,
  setLikedVideos,
  loadNextVideo,
  queueVideo,
  playbackQueue,
  clearQueue,
  activeDeck,
  removeQueuedVideo,
  loadVideo,
  moveQueuedVideo,
  deckA,
  deckB,
}) {
  return (
    <>
      <div className="mix-status">
        <div>
          <h2>
            {activePreset} {isSingleDeck ? 'single-deck mode' : 'mix is active'}
          </h2>
          <p>{isSingleDeck ? `${selectedPlaylist.name} is ready for focused playback on Deck A.` : preset.intent}</p>
        </div>
        <div className="track-actions">
          <button
            className={`icon-button ${activeVideoLiked ? 'active' : ''}`}
            aria-label={activeVideoLiked ? 'Unlike active video' : 'Like active video'}
            onClick={() => toggleLikedVideo(activeVideo)}
            type="button"
          >
            <ThumbsUp size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Dislike and skip active video"
            onClick={() => {
              setLikedVideos((current) => current.filter((id) => id !== activeVideo.id));
              loadNextVideo(1);
            }}
            type="button"
          >
            <ThumbsDown size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Queue active video"
            onClick={() => queueVideo(activeVideo)}
            type="button"
          >
            <ListMusic size={18} />
          </button>
        </div>
      </div>

      <div className="queue-header">
        <h2>{playbackQueue.length ? 'Up next' : isSingleDeck ? selectedPlaylist.name : `Load Into Deck ${activeDeck}`}</h2>
        {playbackQueue.length ? (
          <button className="queue-clear" type="button" onClick={clearQueue}>
            Clear queue
          </button>
        ) : (
          <label className="toggle">
            <input type="checkbox" checked readOnly />
            <span>{isSingleDeck ? 'Single deck' : 'Use selected deck'}</span>
          </label>
        )}
      </div>

      {playbackQueue.length > 0 && (
        <div className="queue user-queue" aria-label="Queued videos">
          {playbackQueue.map((item, index) => (
            <article className="queue-item managed" key={item.id}>
              <button
                className="queue-load"
                onClick={() => {
                  removeQueuedVideo(item.id);
                  loadVideo(item);
                }}
                type="button"
              >
                <div className="thumb">
                  <img alt="" src={`https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`} />
                </div>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.channel}</span>
                </div>
                <small>{item.duration}</small>
              </button>
              <div className="queue-actions">
                <button type="button" onClick={() => queueVideo(item, 'next')} aria-label={`Play ${item.title} next`}>
                  <SkipForward size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => moveQueuedVideo(item.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.title} up`}
                >
                  <ArrowRight size={15} className="rotate-up" />
                </button>
                <button
                  type="button"
                  onClick={() => moveQueuedVideo(item.id, 1)}
                  disabled={index === playbackQueue.length - 1}
                  aria-label={`Move ${item.title} down`}
                >
                  <ArrowRight size={15} className="rotate-down" />
                </button>
                <button type="button" onClick={() => removeQueuedVideo(item.id)} aria-label={`Remove ${item.title} from queue`}>
                  &times;
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="queue">
        {selectedPlaylist.tracks.map((item) => (
          <button
            className={`queue-item ${item.id === deckA.id || (!isSingleDeck && item.id === deckB.id) ? 'selected' : ''}`}
            key={item.id}
            onClick={() => loadVideo(item)}
          >
            <div className="thumb">
              <img alt="" src={`https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`} />
            </div>
            <div>
              <strong>{item.title}</strong>
              <span>{item.channel}</span>
            </div>
            <small>{item.duration}</small>
            <SlidersHorizontal size={16} />
          </button>
        ))}
      </div>
    </>
  );
}
