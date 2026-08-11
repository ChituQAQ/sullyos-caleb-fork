import { describe, expect, it } from 'vitest';
import { deriveListeningFromSnapshot } from './chatRequestPayload';
import { ContextBuilder } from './context';
import type { MusicPlaybackSnapshot, Song } from '../context/MusicContext';

const localSong: Song = {
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

const onlineSong: Song = {
  id: 42,
  name: '在线歌名',
  artists: '在线歌手',
  album: '在线专辑',
  albumPic: 'https://example.test/cover.jpg',
  duration: 180,
  fee: 0,
};

const snapshot = (
  listeningTogetherWith: string[],
  overrides: Partial<MusicPlaybackSnapshot> = {},
): MusicPlaybackSnapshot => ({
  current: localSong,
  playing: true,
  lyric: [{ t: 1, text: '私人歌词行' }],
  activeLyricIdx: 0,
  listeningTogetherWith,
  cfg: { workerUrl: 'https://example.test', cookie: 'secret', quality: 'standard' },
  recentTrackChange: null,
  nowPlaying: {
    trackId: 'safe', title: '安全歌名', artist: '安全歌手', album: '安全专辑',
    durationMs: 123000, positionMs: 1000, isPlaying: true, source: 'local',
  },
  ...overrides,
});

describe('chat request local music awareness and target binding', () => {
  it('gives the current character sanitized pre-join awareness without faking joined state', () => {
    expect(deriveListeningFromSnapshot(snapshot([]), 'char-a')).toMatchObject({
      userListeningContext: { songName: '安全歌名', playbackStatus: 'playing', source: 'local' },
      isListeningTogether: false,
    });
    expect(deriveListeningFromSnapshot(snapshot([]), 'char-b')).toMatchObject({
      userListeningContext: { songName: '安全歌名' }, isListeningTogether: false,
    });
  });

  it('marks only the actual joined character id as listening together', () => {
    const derived = deriveListeningFromSnapshot(snapshot(['char-a']), 'char-a');
    expect(derived.isListeningTogether).toBe(true);
    expect(derived.userListeningContext).toEqual({
      songName: '安全歌名', artists: '安全歌手', album: '安全专辑', playbackStatus: 'playing', source: 'local', lyricWindow: [], activeIdx: -1,
    });
  });

  it('keeps awareness for another character while keeping joined state false', () => {
    expect(deriveListeningFromSnapshot(snapshot(['char-a']), 'char-b')).toMatchObject({
      userListeningContext: { songName: '安全歌名' }, isListeningTogether: false,
    });
  });

  it('partner removal clears joined state but preserves user-listening awareness', () => {
    expect(deriveListeningFromSnapshot(snapshot(['char-a']), 'char-a').isListeningTogether).toBe(true);
    expect(deriveListeningFromSnapshot(snapshot([]), 'char-a')).toMatchObject({
      userListeningContext: { songName: '安全歌名' }, isListeningTogether: false,
    });
  });

  it('does not leak a stale local target or context after switching songs', () => {
    const before = deriveListeningFromSnapshot(snapshot(['xia-id']), 'xia-id');
    const after = deriveListeningFromSnapshot(snapshot([], {
      current: { ...localSong, id: -2, localLibraryTrackId: 'next', name: '下一首' },
      nowPlaying: { trackId: 'next', title: '下一首', artist: '下一位歌手', durationMs: 90000, positionMs: 0, isPlaying: true, source: 'local' },
    }), 'xia-id');
    expect(before.userListeningContext?.songName).toBe('安全歌名');
    expect(after).toMatchObject({ userListeningContext: { songName: '下一首' }, isListeningTogether: false });

    const staleNowPlaying = deriveListeningFromSnapshot(snapshot(['xia-id'], { current: onlineSong }), 'xia-id');
    expect(staleNowPlaying.userListeningContext?.songName).toBe('在线歌名');
    expect(JSON.stringify(staleNowPlaying.userListeningContext)).not.toContain('安全歌名');
  });

  it('does not invent awareness when there is no current song', () => {
    expect(deriveListeningFromSnapshot(snapshot([], { current: null, nowPlaying: null }), 'char-a'))
      .toMatchObject({ userListeningContext: null, isListeningTogether: false });
  });

  it('preserves the existing NetEase listeningTogetherWith behavior', () => {
    const online = snapshot(['xia-id'], {
      current: onlineSong,
      lyric: [{ t: 1, text: '在线歌词' }],
      nowPlaying: null,
    });
    const selected = deriveListeningFromSnapshot(online, 'xia-id');
    const other = deriveListeningFromSnapshot(online, 'other-id');
    expect(selected.isListeningTogether).toBe(true);
    expect(selected.userListeningContext?.songName).toBe('在线歌名');
    expect(selected.userListeningContext?.lyricWindow).toEqual(['在线歌词']);
    expect(other.isListeningTogether).toBe(false);
    expect(other.userListeningContext?.songName).toBe('在线歌名');
  });

  it('never exposes local paths, lyrics, cookies, artwork, or binary references', () => {
    const context = deriveListeningFromSnapshot(snapshot(['xia-id']), 'xia-id').userListeningContext;
    expect(JSON.stringify(context)).not.toMatch(/Private|歌词|cookie|blob|asset|artwork|file:\/\//i);
  });

  it('uses observer wording before join and joined wording only for the selected character', () => {
    const char = { id: 'char-a', name: '角色 A' } as any;
    const listening = deriveListeningFromSnapshot(snapshot([]), 'char-a').userListeningContext!;
    const before = ContextBuilder.buildMusicAtmosphere(char, '用户', listening, null, false);
    const after = ContextBuilder.buildMusicAtmosphere(char, '用户', listening, null, true);
    expect(before).toContain('用户 正在听《安全歌名》');
    expect(before).not.toContain('一起听《安全歌名》');
    expect(after).toContain('你正在和 用户 一起听《安全歌名》');
    expect(before).toContain('播放状态：正在播放');
    expect(before).not.toMatch(/Private|must-not-leak|localLibraryTrackId|trackId|handle|relativePath|cookie|私人歌词/i);
  });
});
