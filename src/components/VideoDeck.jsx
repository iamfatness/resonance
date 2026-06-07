import { Music2, Pause, Play, Search, SlidersHorizontal, Volume2 } from 'lucide-react';
import { isYoutubeLoadInput, parseYoutubePlaylistId } from '../lib/youtube.js';

export function VideoDeck({
  label,
  video,
  query,
  setQuery,
  onSubmit,
  player,
  volume,
  setVolume,
  pan,
  setPan,
  filter,
  setFilter,
  active,
  onActivate,
  onOpenEffects,
  isDesktop = false,
  nativeRouting = null,
}) {
  const actionLabel = parseYoutubePlaylistId(query)
    ? 'Import'
    : isYoutubeLoadInput(query)
      ? 'Load'
      : 'Search';

  return (
    <article className={`deck ${active ? 'active' : ''}`}>
      <div className="deck-topline">
        <button className="deck-label" onClick={onActivate} type="button">
          <Music2 size={17} />
          <span>Deck {label}</span>
        </button>
        <div className="deck-state-stack">
          <span className="deck-state">{player.ready ? 'YouTube ready' : 'Loading'}</span>
          <span className="route-chip idle">Browser isolated</span>
        </div>
      </div>
      {isDesktop && nativeRouting && (
        <div className="deck-routing-summary" aria-label={`Deck ${label} native routing status`}>
          <span className={`route-chip ${nativeRouting.sourceTone}`}>Native: {nativeRouting.sourceLabel}</span>
          <span className={`route-chip ${nativeRouting.vst3Tone}`}>VST3: {nativeRouting.vst3Label}</span>
        </div>
      )}
      <form className="deck-search" onSubmit={onSubmit}>
        <Search size={16} />
        <input
          aria-label={`Deck ${label} paste YouTube link or search for video`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Paste YouTube link or search Deck ${label}`}
        />
        <button type="submit">{actionLabel}</button>
      </form>
      <div className="video-frame">
        <div ref={player.containerRef} className="youtube-target" />
      </div>
      <div className="deck-meta">
        <div>
          <h1>{video.title}</h1>
          <p>
            {video.channel} - YouTube playback - {video.duration}
          </p>
          <small className="deck-route-note">
            {isDesktop
              ? 'YouTube iframe audio is mix-only here. Use a local/captured source for native EQ and VST3.'
              : 'YouTube iframe audio is mix-only; direct audio sources use real EQ.'}
          </small>
        </div>
        <button
          className="icon-button"
          onClick={player.toggle}
          aria-label={player.playing ? `Pause Deck ${label}` : `Play Deck ${label}`}
        >
          {player.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </div>
      <label className="deck-volume">
        <span>
          <Volume2 size={16} />
          Deck {label}
        </span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label={`Deck ${label} volume`}
        />
        <strong>{volume}%</strong>
      </label>
      <label className="deck-volume deck-pan">
        <span>
          <SlidersHorizontal size={16} />
          Filter
        </span>
        <input
          type="range"
          min="-50"
          max="50"
          value={filter}
          onChange={(event) => setFilter(Number(event.target.value))}
          aria-label={`Deck ${label} filter`}
        />
        <strong>{filter === 0 ? 'Off' : filter < 0 ? `Dark ${Math.abs(filter)}` : `Bright ${filter}`}</strong>
      </label>
      <label className="deck-volume deck-pan">
        <span>
          <SlidersHorizontal size={16} />
          Balance
        </span>
        <input
          type="range"
          min="-50"
          max="50"
          value={pan}
          onChange={(event) => setPan(Number(event.target.value))}
          aria-label={`Deck ${label} pan`}
        />
        <strong>{pan === 0 ? 'C' : pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`}</strong>
      </label>
      {onOpenEffects && (
        <button className="deck-effects-button" type="button" onClick={onOpenEffects}>
          <SlidersHorizontal size={16} />
          Deck {label} Effects
        </button>
      )}
    </article>
  );
}
