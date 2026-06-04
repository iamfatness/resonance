import {
  CirclePlay,
  Heart,
  History,
  Library,
  ListMusic,
  Plus,
  Radio,
  Shuffle,
  ThumbsUp,
} from 'lucide-react';

const sidebarNavItems = [
  ['now', CirclePlay, 'Now Playing'],
  ['library', Library, 'Library'],
  ['playlists', ListMusic, 'Playlists'],
  ['history', History, 'History'],
  ['liked', Heart, 'Liked Videos'],
  ['radio', Radio, 'Radio'],
];

export function SidebarPanels({
  activeSidePanel,
  setActiveSidePanel,
  activeVideoLiked,
  toggleLikedVideo,
  deckA,
  deckB,
  isSingleDeck,
  activeDeck,
  setActiveDeck,
  availablePlaylists,
  likedVideos,
  selectedPlaylistName,
  selectPlaylist,
  selectReferenceTracks,
  queueSeed,
  playHistory,
  setPlayHistory,
  sidebarLoad,
  startRadio,
}) {
  const likedPanelVideos = [...queueSeed, ...playHistory].filter(
    (video, index, list) =>
      likedVideos.includes(video.id) && list.findIndex((item) => item.id === video.id) === index,
  );

  return (
    <aside className="sidebar">
      <nav>
        {sidebarNavItems.map(([panel, Icon, label]) => (
          <button
            className={activeSidePanel === panel ? 'active' : ''}
            key={panel}
            type="button"
            onClick={() => setActiveSidePanel(panel)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {activeSidePanel === 'now' && (
        <section className="sidebar-panel">
          <div className="section-title">
            <span>Now Playing</span>
            <button type="button" onClick={() => toggleLikedVideo()}>
              {activeVideoLiked ? <ThumbsUp size={15} /> : <Heart size={15} />}
            </button>
          </div>
          {[
            ['A', deckA],
            ...(isSingleDeck ? [] : [['B', deckB]]),
          ].map(([label, video]) => (
            <button
              className={`side-track ${activeDeck === label ? 'active' : ''}`}
              key={label}
              type="button"
              onClick={() => setActiveDeck(label)}
            >
              <img alt="" src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} />
              <span>
                <strong>Deck {label}</strong>
                <small>{video.title}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      {activeSidePanel === 'library' && (
        <section className="sidebar-panel">
          <div className="section-title">
            <span>Library</span>
            <Library size={16} />
          </div>
          <div className="library-stat">
            <strong>{availablePlaylists.length}</strong>
            <span>Playlists</span>
          </div>
          <div className="library-stat">
            <strong>
              {
                new Set(
                  availablePlaylists.flatMap((playlist) => playlist.tracks.map((track) => track.id)),
                ).size
              }
            </strong>
            <span>Tracks</span>
          </div>
          <div className="library-stat">
            <strong>{likedVideos.length}</strong>
            <span>Liked</span>
          </div>
        </section>
      )}
      {activeSidePanel === 'playlists' && (
        <section className="sidebar-panel">
          <div className="section-title">
            <span>Playlists</span>
            <Plus size={16} />
          </div>
          {availablePlaylists.map((playlist, index) => (
            <button
              className={`playlist-row ${selectedPlaylistName === playlist.name ? 'active' : ''}`}
              key={playlist.name}
              onClick={() => selectPlaylist(playlist)}
              type="button"
            >
              <span>{playlist.name}</span>
              <span>{playlist.tracks.length || [24, 31, 18, 27][index]}</span>
            </button>
          ))}
          <button className="playlist-row" type="button" onClick={selectReferenceTracks}>
            <span>Reference Tracks</span>
            <span>{queueSeed.length}</span>
          </button>
        </section>
      )}
      {activeSidePanel === 'history' && (
        <section className="sidebar-panel">
          <div className="section-title">
            <span>History</span>
            <button type="button" onClick={() => setPlayHistory([])}>
              Clear
            </button>
          </div>
          {playHistory.length === 0 && <p className="side-empty">No recent playback.</p>}
          {playHistory.map((video) => (
            <button className="side-track" key={video.id} type="button" onClick={() => sidebarLoad(video)}>
              <img alt="" src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} />
              <span>
                <strong>{video.title}</strong>
                <small>{video.channel}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      {activeSidePanel === 'liked' && (
        <section className="sidebar-panel">
          <div className="section-title">
            <span>Liked Videos</span>
            <Heart size={16} />
          </div>
          {likedPanelVideos.length === 0 && <p className="side-empty">Like a deck to pin it here.</p>}
          {likedPanelVideos.map((video) => (
            <button className="side-track" key={video.id} type="button" onClick={() => sidebarLoad(video)}>
              <img alt="" src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} />
              <span>
                <strong>{video.title}</strong>
                <small>{video.channel}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      {activeSidePanel === 'radio' && (
        <section className="sidebar-panel">
          <div className="section-title">
            <span>Radio</span>
            <Radio size={16} />
          </div>
          <button className="side-action" type="button" onClick={startRadio}>
            <Shuffle size={16} />
            Start from library
          </button>
          <p className="side-empty">Radio picks a track from the current library and loads it into the active deck.</p>
        </section>
      )}
    </aside>
  );
}
