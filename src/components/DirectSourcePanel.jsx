import { BadgeInfo, Upload } from 'lucide-react';

export function DirectSourcePanel({ directUrl, setDirectUrl, localEq }) {
  return (
    <section className="direct-source priority-source player-source">
      <div className="panel-heading">
        <h2>Upload / Paste Audio</h2>
        <BadgeInfo size={16} />
      </div>
      <div className="direct-controls">
        <label className="file-button">
          <Upload size={16} />
          <span>Audio File</span>
          <input type="file" accept="audio/*" onChange={(event) => localEq.setFile(event.target.files?.[0])} />
        </label>
        <input value={directUrl} onChange={(event) => setDirectUrl(event.target.value)} placeholder="Paste direct audio URL" />
      </div>
      <audio
        ref={localEq.audioRef}
        src={localEq.audioSource || undefined}
        controls
        crossOrigin="anonymous"
        onPlay={localEq.activate}
      />
      <canvas ref={localEq.graphRef} width="460" height="120" />
    </section>
  );
}
