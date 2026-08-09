import { beforeEach, describe, expect, it } from 'vitest';
import { importLocalMediaFiles, metadataFromParser, playbackCapability } from './metadata';
import { listLocalTracks, removeLocalTrack } from './library';
import { TimestampFormat } from 'music-metadata';

const parsed = (overrides: any = {}) => ({
  format: { duration: 12.345, codec: 'MPEG 1 Layer 3', container: 'MPEG', ...(overrides.format || {}) },
  common: {
    title: '标题', artist: '歌手', album: '专辑', albumartist: '专辑歌手',
    track: { no: 2, of: 8 }, disk: { no: 1, of: 1 }, ...(overrides.common || {}),
  },
  native: {}, quality: { warnings: [] },
});

describe('local metadata extraction and batch import', () => {
  beforeEach(async () => {
    for (const item of await listLocalTracks()) await removeLocalTrack(item.id);
  });

  it('normalizes tagged metadata including album artist and track/disc', () => {
    const file = new File(['x'], '歌曲.mp3', { type: 'audio/mpeg' });
    const result = metadataFromParser(file, parsed() as any, 'id');
    expect(result).toMatchObject({ title: '标题', artist: '歌手', album: '专辑', albumArtist: '专辑歌手', durationMs: 12345, trackNumber: 2, discNumber: 1 });
  });

  it('falls back to Unicode filename when title is empty and permits missing artist', () => {
    const file = new File(['x'], '没有标题.flac', { type: 'audio/flac' });
    const result = metadataFromParser(file, parsed({ common: { title: ' ', artist: undefined } }) as any, 'id');
    expect(result.title).toBe('没有标题');
    expect(result.artist).toBeUndefined();
  });

  it('prefers a front-cover picture', () => {
    const back = { format: 'image/png', type: 'Cover (back)', data: new Uint8Array([1]) };
    const front = { format: 'image/jpeg', type: 'Cover (front)', data: new Uint8Array([2]) };
    const result = metadataFromParser(new File(['x'], 'cover.mp3'), parsed({ common: { picture: [back, front] } }) as any, 'id');
    expect([...result.artwork!.data]).toEqual([2]);
  });

  it('imports matched sidecar LRC and isolates a parser failure', async () => {
    const files = [
      new File(['good'], 'song.flac', { type: 'audio/flac' }),
      new File(['[00:01.00]第一句'], 'song.lrc', { type: 'text/plain' }),
      new File(['fallback'], 'broken.mp3', { type: 'audio/mpeg' }),
    ];
    const summary = await importLocalMediaFiles(files, {
      audio: { canPlayType: () => 'probably' },
      parse: (async (file: Blob) => {
        if ((file as File).name === 'broken.mp3') throw new Error('bad tags');
        return parsed();
      }) as any,
      now: () => 123,
    });
    expect(summary).toMatchObject({ imported: 2, failed: 0, metadataFallback: 1, destructiveChanges: 0 });
    const song = summary.items.find(item => item.filename === 'song.flac')?.track;
    expect(song?.lyrics).toMatchObject({ kind: 'synced', source: 'external-lrc' });
    expect(summary.items.find(item => item.filename === 'broken.mp3')?.track?.metadata.title).toBe('broken');
  });

  it('normalizes embedded synchronized and plain lyrics without fabricating plain timestamps', async () => {
    const syncFile = new File(['sync'], 'sync.mp3', { type: 'audio/mpeg' });
    const plainFile = new File(['plain'], 'plain.mp3', { type: 'audio/mpeg' });
    const summary = await importLocalMediaFiles([syncFile, plainFile], {
      audio: { canPlayType: () => 'probably' },
      parse: (async (file: Blob) => parsed({ common: {
        lyrics: (file as File).name === 'sync.mp3' ? [{
          contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: '同步行' }],
        }] : [{ contentType: 1, timeStampFormat: TimestampFormat.notSynchronized, syncText: [], text: '普通第一行\n普通第二行' }],
      } })) as any,
    });
    expect(summary.items.find(item => item.filename === 'sync.mp3')?.track?.lyrics).toMatchObject({ kind: 'synced', source: 'embedded-synced' });
    const plain = summary.items.find(item => item.filename === 'plain.mp3')?.track?.lyrics;
    expect(plain?.kind).toBe('plain');
    expect(plain?.lines.every(line => line.timeMs === undefined)).toBe(true);
  });

  it('reports duplicate and unsupported files without aborting the batch', async () => {
    const file = new File(['same'], 'duplicate.mp3', { type: 'audio/mpeg' });
    const options: Parameters<typeof importLocalMediaFiles>[1] = {
      audio: { canPlayType: () => 'maybe' },
      parse: (async () => parsed()) as any,
    };
    expect((await importLocalMediaFiles([file], options)).imported).toBe(1);
    const summary = await importLocalMediaFiles([new File(['same'], 'renamed.mp3', { type: 'audio/mpeg' }), new File(['x'], 'notes.txt')], options);
    expect(summary.duplicates).toBe(1);
    expect(summary.unsupported).toBe(1);
  });

  it.each([
    ['track.mp3', 'audio/mpeg'], ['track.wav', 'audio/wav'], ['track.flac', 'audio/flac'],
    ['track.m4a', 'audio/mp4'], ['track.aac', 'audio/aac'], ['track.ogg', 'audio/ogg'], ['track.mp4', 'video/mp4'],
  ])('checks runtime decode capability for %s', (name, mime) => {
    expect(playbackCapability({ name, type: mime } as File, { canPlayType: type => type === mime ? 'maybe' : '' })).toBe('supported');
    expect(playbackCapability({ name, type: mime } as File, { canPlayType: () => '' })).toBe('unsupported');
  });
});
