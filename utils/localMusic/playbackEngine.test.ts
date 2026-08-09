import { describe, expect, it, vi } from 'vitest';
import { HtmlAudioPlaybackEngine, PlaybackRequestGate, nextQueueIndex } from './playbackEngine';

class FakeAudio {
  preload = '';
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 100;
  volume = 1;
  error: { message: string } | null = null;
  listeners = new Map<string, Set<EventListener>>();
  addEventListener(name: string, listener: EventListener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name)!.add(listener); }
  removeEventListener(name: string, listener: EventListener) { this.listeners.get(name)?.delete(listener); }
  dispatch(name: string) { this.listeners.get(name)?.forEach(listener => listener(new Event(name))); }
  async play() { this.paused = false; this.dispatch('play'); }
  pause() { this.paused = true; this.dispatch('pause'); }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}

describe('HTML audio playback engine', () => {
  it('loads, plays, pauses, seeks, changes volume, ends and reports errors', async () => {
    const audio = new FakeAudio();
    const events: string[] = [];
    const engine = new HtmlAudioPlaybackEngine(audio as any);
    engine.subscribe(event => events.push(event.state));
    engine.loadUrl('https://example.test/song.mp3');
    await engine.play();
    engine.seekSeconds(42);
    engine.setVolume(0.4);
    engine.pause();
    audio.ended = true;
    audio.dispatch('ended');
    audio.error = { message: 'decoder failed' };
    audio.dispatch('error');
    expect(audio.currentTime).toBe(42);
    expect(audio.volume).toBe(0.4);
    expect(events).toEqual(expect.arrayContaining(['loading', 'playing', 'paused', 'ended', 'error']));
    engine.dispose();
  });

  it('revokes the previous object URL on track switch and dispose', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const engine = new HtmlAudioPlaybackEngine(new FakeAudio() as any);
    engine.loadBlob(new Blob(['one']));
    engine.loadBlob(new Blob(['two']));
    engine.dispose();
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenNthCalledWith(1, 'blob:first');
    expect(revoke).toHaveBeenNthCalledWith(2, 'blob:second');
    create.mockRestore();
    revoke.mockRestore();
  });

  it('handles next/ended queue boundaries and rejects stale async ownership', () => {
    expect(nextQueueIndex(1, 3, 'loop')).toBe(2);
    expect(nextQueueIndex(2, 3, 'loop')).toBe(0);
    expect(nextQueueIndex(1, 3, 'single')).toBe(1);
    expect(nextQueueIndex(0, 3, 'shuffle', () => 0.8)).toBe(2);
    const gate = new PlaybackRequestGate();
    const stale = gate.begin();
    const current = gate.begin();
    expect(gate.isCurrent(stale)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
  });
});
