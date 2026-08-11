import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatParser, type MusicActionHooks, type MusicActionSnapshot } from './chatParser';
import { DB } from './db';
import { deriveListeningFromSnapshot } from './chatRequestPayload';
import type { MusicPlaybackSnapshot, Song } from '../context/MusicContext';

afterEach(() => vi.restoreAllMocks());

const localSnapshot: MusicActionSnapshot = {
  songId: -123,
  name: '本地歌曲',
  artists: '本地歌手',
  album: '本地专辑',
  albumPic: 'xiafork-local-artwork:track-safe',
  duration: 210,
  fee: 0,
};

describe('official MUSIC_ACTION flow with a local snapshot', () => {
  it('joins the actual conversation character and persists only the safe song snapshot', async () => {
    const joinListeningTogether = vi.fn();
    const save = vi.spyOn(DB, 'saveMessage').mockResolvedValue(undefined as any);
    const hooks: MusicActionHooks = {
      getListeningSnapshot: () => localSnapshot,
      joinListeningTogether,
      addSongToCharPlaylist: vi.fn(async () => null),
    };

    const bubbles = await ChatParser.parseAndExecuteActions(
      '我也来。[[MUSIC_ACTION:join]]', 'char-a', '角色 A', vi.fn(), hooks,
    );

    expect(joinListeningTogether).toHaveBeenCalledWith('char-a');
    expect(String(bubbles)).not.toContain('MUSIC_ACTION');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      charId: 'char-a',
      type: 'music_card',
      metadata: expect.objectContaining({ intent: 'join', song: localSnapshot }),
    }));
    expect(JSON.stringify(save.mock.calls)).not.toMatch(/relativePath|sourceRootId|handle|content:\/\/|audioBlob|lyrics/i);
  });

  it('transitions awareness=false-joined to awareness=true-joined only after the official join action', async () => {
    vi.spyOn(DB, 'saveMessage').mockResolvedValue(undefined as any);
    const partners: string[] = [];
    const song: Song = {
      id: localSnapshot.songId, name: localSnapshot.name, artists: localSnapshot.artists,
      album: localSnapshot.album, albumPic: localSnapshot.albumPic, duration: localSnapshot.duration,
      fee: 0, local: true, localLibraryTrackId: 'track-safe',
    };
    const makeSnapshot = (): MusicPlaybackSnapshot => ({
      current: song, playing: true, lyric: [], activeLyricIdx: -1,
      listeningTogetherWith: [...partners], cfg: { workerUrl: '', cookie: '', quality: 'standard' },
      recentTrackChange: null,
      nowPlaying: { trackId: 'track-safe', title: song.name, artist: song.artists, album: song.album, durationMs: 210000, positionMs: 1000, isPlaying: true, source: 'local' },
    });
    expect(deriveListeningFromSnapshot(makeSnapshot(), 'char-a')).toMatchObject({
      userListeningContext: { songName: '本地歌曲' }, isListeningTogether: false,
    });

    await ChatParser.parseAndExecuteActions('[[MUSIC_ACTION:join]]', 'char-a', '角色 A', vi.fn(), {
      getListeningSnapshot: () => localSnapshot,
      joinListeningTogether: id => { if (!partners.includes(id)) partners.push(id); },
      addSongToCharPlaylist: vi.fn(async () => null),
    });

    expect(partners).toEqual(['char-a']);
    expect(deriveListeningFromSnapshot(makeSnapshot(), 'char-a')).toMatchObject({
      userListeningContext: { songName: '本地歌曲' }, isListeningTogether: true,
    });
    expect(deriveListeningFromSnapshot(makeSnapshot(), 'char-b')).toMatchObject({
      userListeningContext: { songName: '本地歌曲' }, isListeningTogether: false,
    });
  });

  it('does not invent a join when there is no current-song snapshot', async () => {
    const joinListeningTogether = vi.fn();
    const hooks: MusicActionHooks = {
      getListeningSnapshot: () => null,
      joinListeningTogether,
      addSongToCharPlaylist: vi.fn(async () => null),
    };
    await ChatParser.parseAndExecuteActions(
      '[[MUSIC_ACTION:join]]', 'char-a', '角色 A', vi.fn(), hooks,
    );
    expect(joinListeningTogether).not.toHaveBeenCalled();
  });
});
