export type PlaybackEngineState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackEngineEvents {
  state: PlaybackEngineState;
  positionSeconds: number;
  durationSeconds: number;
  error?: string;
}

export interface PlaybackEngine {
  readonly element: HTMLAudioElement;
  readonly currentState: PlaybackEngineState;
  loadUrl(url: string): void;
  loadBlob(blob: Blob): void;
  play(): Promise<void>;
  pause(): void;
  seekSeconds(seconds: number): void;
  setVolume(volume: number): void;
  subscribe(listener: (events: PlaybackEngineEvents) => void): () => void;
  dispose(): void;
}

export class PlaybackRequestGate {
  private current = 0;
  begin(): number { this.current += 1; return this.current; }
  isCurrent(requestId: number): boolean { return requestId === this.current; }
}

export function nextQueueIndex(current: number, length: number, mode: 'loop' | 'single' | 'shuffle', random = Math.random): number {
  if (length <= 0 || current < 0) return -1;
  if (mode === 'single' || length === 1) return current;
  if (mode === 'shuffle') {
    let next = current;
    while (next === current) next = Math.floor(random() * length);
    return next;
  }
  return (current + 1) % length;
}

export class HtmlAudioPlaybackEngine implements PlaybackEngine {
  readonly element: HTMLAudioElement;
  private objectUrl: string | null = null;
  private listeners = new Set<(events: PlaybackEngineEvents) => void>();
  private state: PlaybackEngineState = 'idle';
  private desiredPlaying = false;
  private playRequest = 0;
  private readonly handlers: Array<[string, EventListener]>;

  constructor(element: HTMLAudioElement = new Audio()) {
    this.element = element;
    this.element.preload = 'metadata';
    const bind = (event: string, handler: EventListener): [string, EventListener] => {
      this.element.addEventListener(event, handler);
      return [event, handler];
    };
    this.handlers = [
      bind('loadstart', () => this.emit('loading')),
      bind('play', () => {
        if (!this.desiredPlaying) { this.element.pause(); return; }
      }),
      bind('pause', () => { this.desiredPlaying = false; this.playRequest += 1; this.emit('paused'); }),
      bind('ended', () => { this.desiredPlaying = false; this.emit('ended'); }),
      bind('error', () => { this.desiredPlaying = false; this.emit('error', this.element.error?.message || 'Audio playback failed'); }),
      bind('timeupdate', () => this.emit(this.state)),
      bind('loadedmetadata', () => this.emit(this.state === 'loading' ? 'paused' : this.state)),
    ];
  }

  private emit(state: PlaybackEngineState, error?: string) {
    this.state = state;
    const event = {
      state,
      positionSeconds: Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0,
      durationSeconds: Number.isFinite(this.element.duration) ? this.element.duration : 0,
      error,
    };
    this.listeners.forEach(listener => listener(event));
  }

  get currentState() { return this.state; }

  private releaseObjectUrl() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  loadUrl(url: string) {
    this.desiredPlaying = false;
    this.playRequest += 1;
    this.element.pause();
    this.releaseObjectUrl();
    this.emit('loading');
    this.element.src = url;
  }

  loadBlob(blob: Blob) {
    this.desiredPlaying = false;
    this.playRequest += 1;
    this.element.pause();
    this.releaseObjectUrl();
    this.objectUrl = URL.createObjectURL(blob);
    this.emit('loading');
    this.element.src = this.objectUrl;
  }

  async play() {
    this.desiredPlaying = true;
    const request = ++this.playRequest;
    try {
      await this.element.play();
      if (request === this.playRequest && this.desiredPlaying && !this.element.paused) this.emit('playing');
    } catch (error) {
      if (request === this.playRequest) {
        this.desiredPlaying = false;
        this.emit('error', error instanceof Error ? error.message : 'Audio playback failed');
      }
      throw error;
    }
  }
  pause() { this.desiredPlaying = false; this.playRequest += 1; this.element.pause(); }
  seekSeconds(seconds: number) { this.element.currentTime = Math.max(0, Math.min(this.element.duration || seconds, seconds)); this.emit(this.state); }
  setVolume(volume: number) { this.element.volume = Math.max(0, Math.min(1, volume)); }
  subscribe(listener: (events: PlaybackEngineEvents) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose() {
    this.desiredPlaying = false;
    this.playRequest += 1;
    this.handlers.forEach(([event, handler]) => this.element.removeEventListener(event, handler));
    this.element.pause();
    this.element.removeAttribute('src');
    this.releaseObjectUrl();
    this.listeners.clear();
    this.state = 'idle';
  }
}
