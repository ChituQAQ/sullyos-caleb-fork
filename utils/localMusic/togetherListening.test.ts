import { describe, expect, it } from 'vitest';
import { createNowPlayingState, formatTogetherListeningContext, getTogetherListeningContext } from './togetherListening';

describe('local Together Listening privacy bridge', () => {
  const nowPlaying = createNowPlayingState({
    trackId: 'safe-id', title: '夜航星', artist: '不才', album: '专辑',
    durationSeconds: 245.5, positionSeconds: 12.25, isPlaying: true,
  });

  it('reflects player state without exposing prompt-time ticking', () => {
    expect(nowPlaying).toMatchObject({ durationMs: 245500, positionMs: 12250, isPlaying: true, source: 'local' });
  });

  it('returns no context when no local track is current', () => {
    expect(getTogetherListeningContext(false, nowPlaying)).toBeNull();
  });

  it('shares only safe metadata for playing and paused snapshots', () => {
    const internal = { ...nowPlaying, privateSourcePath: 'E:\\Private\\song.flac', lyrics: '整首歌词', artworkBytes: new Uint8Array([1, 2]), audioBlob: new Blob(['audio']) };
    const context = getTogetherListeningContext(true, internal);
    const prompt = formatTogetherListeningContext(context);
    expect(prompt).toContain('标题：夜航星');
    expect(prompt).toContain('状态：正在播放');
    expect(prompt).not.toMatch(/E:\\|C:\\|file:\/\/|content:\/\/|整首歌词|artwork|audio/i);
    expect(getTogetherListeningContext(true, { ...nowPlaying, isPlaying: false })?.status).toBe('paused');
  });
});
