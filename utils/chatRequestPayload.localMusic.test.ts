import { describe, expect, it } from 'vitest';
import { deriveListeningFromSnapshot } from './chatRequestPayload';
import type { MusicPlaybackSnapshot, Song } from '../context/MusicContext';

const song: Song = {
  id: -1,
  name: '安全歌名',
  artists: '安全歌手',
  album: '安全专辑',
  albumPic: 'xiafork-local-artwork:safe',
  duration: 123,
  fee: 0,
  local: true,
  localLibraryTrackId: 'safe',
  localAssetKey: 'E:\\Private\\must-not-leak.flac',
  localLyrics: '整首私人歌词',
};

const snapshot = (enabled: boolean): MusicPlaybackSnapshot => ({
  current: song,
  playing: true,
  lyric: [{ t: 1, text: '私人歌词行' }],
  activeLyricIdx: 0,
  listeningTogetherWith: [],
  cfg: { workerUrl: 'https://example.test', cookie: 'secret', quality: 'standard' },
  recentTrackChange: null,
  nowPlaying: {
    trackId: 'safe', title: '安全歌名', artist: '安全歌手', album: '安全专辑',
    durationMs: 123000, positionMs: 1000, isPlaying: true, source: 'local',
  },
  togetherListeningEnabled: enabled,
});
describe('chat request local music bridge', () => {
  it('injects nothing for imported local music while disabled', () => {
    expect(deriveListeningFromSnapshot(snapshot(false), 'char').userListeningContext).toBeNull();
  });

  it('injects only metadata while enabled', () => {
    const derived = deriveListeningFromSnapshot(snapshot(true), 'char');
    expect(derived.isListeningTogether).toBe(true);
    expect(derived.userListeningContext).toEqual({
      songName: '安全歌名', artists: '安全歌手', album: '安全专辑', playbackStatus: 'playing', source: 'local', lyricWindow: [], activeIdx: -1,
    });
    expect(JSON.stringify(derived.userListeningContext)).not.toMatch(/Private|歌词|cookie|blob|asset/i);
  });
});
