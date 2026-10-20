"use client";
import { createBrowserVoiceBridge } from "@/features/orb/bridge/browserVoiceBridge";
import { loadOrbRuntime, orbAudioHandle, orbBridgeHandle } from "@/features/orb/orbHub";
import { isStandaloneMock } from "@/lib/mock/runtime";
import { BrowserAudioResampler } from "./browserAudioResampler";

type AudioState = { available: boolean; active: boolean; paused: boolean; speaking: boolean; error: string | null };
const FRAME_SAMPLES = 1_280;
const FRAME_BYTES = FRAME_SAMPLES * 2;
const MAX_BUFFERED = FRAME_BYTES * 10;
const PATH = "/api/v1/voice/browser-audio";
let state: AudioState = { available: false, active: false, paused: false, speaking: false, error: null };
const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let context: AudioContext | null = null;
let stream: MediaStream | null = null;
let capture: AudioWorkletNode | null = null;
let nextPlayback = 0;
let pending: number[] = [];
let playbackSources = new Set<AudioBufferSourceNode>();
let readiness: Promise<void> | null = null;
let lastCheck = 0;
let outputBus: GainNode | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let passiveProbe: () => boolean = () => false;

/** Orb taps: microphone/TTS analysers and lifecycle facts (docs/ORB_REWORK_ANALYSIS.md §8). Best effort, never blocks voice. */
const orbVoice = createBrowserVoiceBridge({ bridge: orbBridgeHandle.proxy, audio: orbAudioHandle.proxy, loadRuntime: loadOrbRuntime });

/** The orb stays idle while the wake word is armed and nothing was said; the realtime layer supplies that fact. */
export function setBrowserAudioPassiveProbe(probe: () => boolean): void {
  passiveProbe = probe;
}

/** Milliseconds of already scheduled TTS audio that still has to play. */
function remainingPlaybackMs(): number {
  return context ? Math.max(0, (nextPlayback - context.currentTime) * 1000) : 0;
}

function publish(update: Partial<AudioState>): void {
  state = { ...state, ...update };
  for (const listener of listeners) listener();
}

export const browserAudio = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot() { return state; },
  async check() {
    if (isStandaloneMock()) return; // the in-browser mock has no Control API (and no gateway) behind the availability route
    if (readiness) return readiness;
    if (Date.now() - lastCheck < 10_000) return;
    readiness = (async () => {
      try {
        const response = await fetch("/api/v1/voice/browser-audio-availability", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { available?: boolean };
        if (!state.active) publish({ available: data.available === true });
      } catch { /* Windows and offline dashboards retain their existing voice controls. */ }
      finally { lastCheck = Date.now(); readiness = null; }
    })();
    return readiness;
  },
  async start() {
    if (state.active || socket) return;
    if (!window.isSecureContext) throw new Error("Mikrofon nur über HTTPS oder localhost verfügbar.");
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Dieser Browser unterstützt die benötigte Mikrofonaufnahme nicht.");
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
    stream = media;
    try {
      const audio = new AudioContext();
      context = audio;
      // The microphone is open as soon as the stream exists: tell the orb now instead of after the worklet and socket setup.
      const source = audio.createMediaStreamSource(media);
      micSource = source;
      outputBus = audio.createGain();
      outputBus.connect(audio.destination);
      orbVoice.attachOutput(audio, outputBus);
      orbVoice.microphoneOpened(audio, source, { passive: passiveProbe() });
      await audio.resume();
      await audio.audioWorklet.addModule("/browser-audio-worklet.js");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}${PATH}`);
      socket = ws;
      ws.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Der Browser-Sprachdienst ist nicht erreichbar."));
        ws.onclose = () => reject(new Error("Der Browser-Sprachdienst hat die Verbindung beendet."));
      });
      const node = new AudioWorkletNode(audio, "friday-capture");
      capture = node;
      const silent = audio.createGain();
      silent.gain.value = 0;
      source.connect(node).connect(silent).connect(audio.destination);
      pending = [];
      const resampler = new BrowserAudioResampler(audio.sampleRate);
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (state.paused || ws.readyState !== WebSocket.OPEN) return;
        pending.push(...resampler.push(event.data));
        while (pending.length >= FRAME_SAMPLES) {
          if (ws.bufferedAmount > MAX_BUFFERED) { browserAudio.stop(); return; }
          const frame = new ArrayBuffer(FRAME_BYTES);
          const view = new DataView(frame);
          for (let i = 0; i < FRAME_SAMPLES; i++) view.setInt16(i * 2, Math.round((pending[i] ?? 0) * 32767), true);
          pending = pending.slice(FRAME_SAMPLES);
          ws.send(frame);
        }
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) playPcm(event.data);
        else if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as { type?: string; frequency?: number; durationMs?: number; state?: string };
            if (message.type === "clear") { clearPlayback(); orbVoice.ttsInterrupted(); publish({ speaking: false }); }
            if (message.type === "beep") playBeep(message.frequency ?? 650, message.durationMs ?? 90);
            if (message.type === "audio_start") { nextPlayback = Math.max(audio.currentTime, nextPlayback); orbVoice.ttsStarted(); publish({ speaking: true }); }
            if (message.type === "audio_end") { orbVoice.ttsFinished(remainingPlaybackMs()); publish({ speaking: false }); }
            if (message.type === "status") {
              if (message.state === "speaking") orbVoice.ttsStarted();
              else if (orbVoice.speaking) orbVoice.ttsFinished(remainingPlaybackMs());
              if (message.state === "paused") orbVoice.microphoneClosed();
              publish({ paused: message.state === "paused", speaking: message.state === "speaking" });
            }
          } catch { /* Invalid service message cannot change capture state. */ }
        }
      };
      ws.onclose = () => {
        const unexpected = socket === ws;
        browserAudio.stop();
        if (unexpected) publish({ error: "Sprachverbindung beendet." });
      };
      publish({ active: true, paused: false, speaking: false, error: null });
    } catch (error) {
      browserAudio.stop();
      throw error;
    }
  },
  stop() {
    const ws = socket;
    socket = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send('{"type":"stop"}');
    ws?.close();
    capture?.disconnect();
    capture = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    clearPlayback();
    orbVoice.dispose(); // barge-in: speaking and microphone facts end before the context is released
    orbVoice.microphoneClosed();
    outputBus = null;
    micSource = null;
    void context?.close();
    context = null;
    pending = [];
    publish({ active: false, paused: false, speaking: false });
  },
  pause() {
    if (socket?.readyState === WebSocket.OPEN) socket.send('{"type":"pause"}');
    clearPlayback();
    orbVoice.ttsInterrupted();
    orbVoice.microphoneClosed();
    publish({ paused: true, speaking: false });
  },
  resume() {
    if (socket?.readyState === WebSocket.OPEN) socket.send('{"type":"resume"}');
    if (context && micSource) orbVoice.microphoneOpened(context, micSource, { passive: passiveProbe() });
    publish({ paused: false });
  },
  pushToTalkStart() {
    if (socket?.readyState === WebSocket.OPEN && state.active && !state.paused) socket.send('{"type":"start"}');
  },
  pushToTalkRelease() {
    if (socket?.readyState === WebSocket.OPEN && state.active) socket.send('{"type":"release"}');
  },
};

function clearPlayback(): void {
  for (const source of playbackSources) { try { source.stop(); } catch { /* already stopped */ } }
  playbackSources = new Set();
  nextPlayback = context?.currentTime ?? 0;
}

function playPcm(pcm: ArrayBuffer): void {
  if (!context || pcm.byteLength !== FRAME_BYTES) return;
  const view = new DataView(pcm);
  const buffer = context.createBuffer(1, FRAME_SAMPLES, 16_000);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < FRAME_SAMPLES; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(outputBus ?? context.destination);
  source.onended = () => playbackSources.delete(source);
  playbackSources.add(source);
  nextPlayback = Math.max(context.currentTime + 0.02, nextPlayback);
  source.start(nextPlayback);
  nextPlayback += buffer.duration;
}

function playBeep(frequency: number, durationMs: number): void {
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = Math.max(100, Math.min(2000, frequency));
  gain.gain.value = 0.07;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + Math.max(0.02, Math.min(0.4, durationMs / 1000)));
}
