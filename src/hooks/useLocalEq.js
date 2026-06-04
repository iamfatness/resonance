import { useCallback, useEffect, useRef, useState } from 'react';
import { bandFreqs } from '../lib/presets.js';

export function useLocalEq(activePreset, curve, sourceUrl) {
  const audioRef = useRef(null);
  const graphRef = useRef(null);
  const contextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const filtersRef = useRef([]);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(0);
  const localFileUrlRef = useRef('');
  const [localFileUrl, setLocalFileUrl] = useState('');
  const [enabled, setEnabled] = useState(false);

  const stopVisualizer = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
  }, []);

  const revokeLocalFileUrl = useCallback(() => {
    if (!localFileUrlRef.current) return;
    URL.revokeObjectURL(localFileUrlRef.current);
    localFileUrlRef.current = '';
  }, []);

  const disconnectGraph = useCallback(({ updateState = true } = {}) => {
    stopVisualizer();
    sourceNodeRef.current?.disconnect?.();
    filtersRef.current.forEach((filter) => filter.disconnect?.());
    analyserRef.current?.disconnect?.();
    if (contextRef.current && contextRef.current.state !== 'closed') {
      contextRef.current.close();
    }
    contextRef.current = null;
    sourceNodeRef.current = null;
    filtersRef.current = [];
    analyserRef.current = null;
    if (updateState) setEnabled(false);
  }, [stopVisualizer]);

  useEffect(() => {
    filtersRef.current.forEach((filter, index) => {
      filter.gain.setTargetAtTime(curve[index] ?? 0, contextRef.current?.currentTime ?? 0, 0.02);
    });
  }, [curve, activePreset]);

  useEffect(() => {
    const canvas = graphRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return undefined;

    const ctx = canvas.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      animationFrameRef.current = requestAnimationFrame(draw);
      const { width, height } = canvas;
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#091012';
      ctx.fillRect(0, 0, width, height);
      const count = 42;
      const gap = 3;
      const barWidth = (width - gap * (count - 1)) / count;
      for (let i = 0; i < count; i += 1) {
        const value = data[Math.floor((i / count) * data.length)] / 255;
        const barHeight = Math.max(5, value * (height - 12));
        const x = i * (barWidth + gap);
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#f6b44a');
        gradient.addColorStop(0.35, '#35d0c4');
        gradient.addColorStop(1, '#147b77');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      }
    }

    draw();
    return stopVisualizer;
  }, [enabled, stopVisualizer]);

  useEffect(() => {
    return () => {
      disconnectGraph({ updateState: false });
      revokeLocalFileUrl();
    };
  }, [disconnectGraph, revokeLocalFileUrl]);

  const activate = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (contextRef.current) {
      await contextRef.current.resume?.();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const filters = bandFreqs.map((frequency) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;

    source.connect(filters[0]);
    filters.forEach((filter, index) => {
      filter.connect(filters[index + 1] || analyser);
    });
    analyser.connect(context.destination);

    contextRef.current = context;
    sourceNodeRef.current = source;
    filtersRef.current = filters;
    analyserRef.current = analyser;
    filters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(curve[index] ?? 0, context.currentTime, 0.02);
    });
    setEnabled(true);
  };

  const audioSource = localFileUrl || sourceUrl;

  return {
    audioRef,
    graphRef,
    audioSource,
    enabled,
    setFile(file) {
      if (!file) return;
      revokeLocalFileUrl();
      const nextUrl = URL.createObjectURL(file);
      localFileUrlRef.current = nextUrl;
      setLocalFileUrl(nextUrl);
    },
    activate,
  };
}
