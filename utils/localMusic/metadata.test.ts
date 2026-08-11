import { beforeEach, describe, expect, it } from 'vitest';
import { importLocalMediaFiles, importLocalMediaHandles, metadataFromParser, normalizeEmbeddedLyrics, playbackCapability } from './metadata';
import { listLocalTracks, removeLocalTrack } from './library';
import { TimestampFormat } from 'music-metadata';
import type { WebFileSystemFileHandle } from './types';

const parsed = (overrides: any = {}) => ({
  format: { duration: 12.345, codec: 'MPEG 1 Layer 3', container: 'MPEG', ...(overrides.format || {}) },
  common: {
    title: '标题', artist: '歌手', album: '专辑', albumartist: '专辑歌手',
    track: { no: 2, of: 8 }, disk: { no: 1, of: 1 }, ...(overrides.common || {}),
  },
  native: {}, quality: { warnings: [] },
});

const sourceOptions = <T extends object>(extra: T) => ({
  // fake-indexeddb cannot structured-clone native FileSystemHandle methods. A plain
  // handle-shaped token exercises record persistence; resolver behavior is covered separately.
  sourceForFile: (file: File) => ({
    kind: 'web-file-handle' as const,
    handle: { kind: 'file', name: file.name } as WebFileSystemFileHandle,
  }),
  ...extra,
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
    const summary = await importLocalMediaFiles(files, sourceOptions({
      audio: { canPlayType: () => 'probably' },
      parse: (async (file: Blob) => {
        if ((file as File).name === 'broken.mp3') throw new Error('bad tags');
        return parsed();
      }) as any,
      now: () => 123,
    }));
    expect(summary).toMatchObject({ imported: 2, failed: 0, metadataFallback: 1, destructiveChanges: 0 });
    const song = summary.items.find(item => item.filename === 'song.flac')?.track;
    expect(song?.lyrics).toMatchObject({ kind: 'synced', source: 'external-lrc' });
    expect(summary.items.find(item => item.filename === 'broken.mp3')?.track?.metadata.title).toBe('broken');
  });

  it('normalizes embedded synchronized and plain lyrics without fabricating plain timestamps', async () => {
    const syncFile = new File(['sync'], 'sync.mp3', { type: 'audio/mpeg' });
    const plainFile = new File(['plain'], 'plain.mp3', { type: 'audio/mpeg' });
    const summary = await importLocalMediaFiles([syncFile, plainFile], sourceOptions({
      audio: { canPlayType: () => 'probably' },
      parse: (async (file: Blob) => parsed({ common: {
        lyrics: (file as File).name === 'sync.mp3' ? [{
          contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: '同步行' }],
        }] : [{ contentType: 1, timeStampFormat: TimestampFormat.notSynchronized, syncText: [], text: '普通第一行\n普通第二行' }],
      } })) as any,
    }));
    expect(summary.items.find(item => item.filename === 'sync.mp3')?.track?.lyrics).toMatchObject({ kind: 'synced', source: 'embedded-synced' });
    const plain = summary.items.find(item => item.filename === 'plain.mp3')?.track?.lyrics;
    expect(plain?.kind).toBe('plain');
    expect(plain?.lines.every(line => line.timeMs === undefined)).toBe(true);
  });

  it('reports duplicate and unsupported files without aborting the batch', async () => {
    const file = new File(['same'], 'duplicate.mp3', { type: 'audio/mpeg' });
    const options: Parameters<typeof importLocalMediaFiles>[1] = sourceOptions({
      audio: { canPlayType: () => 'maybe' },
      parse: (async () => parsed()) as any,
    });
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

  it('reparses lyrics on an explicit duplicate import so older normalization can be repaired', async () => {
    const file = new File(['same-audio'], 'refresh.mp3', { type: 'audio/mpeg' });
    let primary = '旧主歌词';
    const options: Parameters<typeof importLocalMediaFiles>[1] = sourceOptions({
      audio: { canPlayType: () => 'probably' },
      parse: (async () => parsed({ common: {
        lyrics: [{ contentType: 1, timeStampFormat: TimestampFormat.milliseconds, language: 'zho', syncText: [
          { timestamp: 1000, text: primary }, { timestamp: 1010, text: 'secondary' },
        ] }],
      } })) as any,
    });
    const first = await importLocalMediaFiles([file], options);
    primary = 'updated original';
    const second = await importLocalMediaFiles([file], options);
    expect(second).toMatchObject({ imported: 0, duplicates: 1 });
    expect(second.items[0].message).toContain('歌词已重新解析');
    expect((await listLocalTracks()).find(item => item.id === first.items[0].track?.id)?.lyrics.lines[0].text)
      .toBe('updated original');
  });

  it('uses descriptors to keep a separately tagged original track primary even when translation comes first', () => {
    const tags = [
      { descriptor: 'translation', language: 'zho', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: '中文翻译' }] },
      { descriptor: 'original', language: 'eng', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: 'English original' }] },
    ];
    expect(normalizeEmbeddedLyrics(tags as any).synced.lines[0]).toMatchObject({
      text: 'English original', translationText: '中文翻译',
    });
  });

  it('does not assume Chinese is a translation when tag metadata marks it original', () => {
    const tags = [
      { descriptor: '译文', language: 'eng', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: 'English translation' }] },
      { descriptor: '原文', language: 'zho', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: '中文原文' }] },
    ];
    expect(normalizeEmbeddedLyrics(tags as any).synced.lines[0]).toMatchObject({
      text: '中文原文', translationText: 'English translation',
    });
  });

  it('uses the audio language to recover an English primary track when source order starts with Chinese', () => {
    const tags = [
      { descriptor: '', language: 'zho', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: '中文翻译' }] },
      { descriptor: '', language: 'eng', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: 'English original' }] },
    ];
    const result = normalizeEmbeddedLyrics(tags as any, { trackLanguage: 'eng' });
    expect(result.synced.lines[0]).toMatchObject({ text: 'English original', translationText: '中文翻译' });
    expect(result.diagnostic).toMatchObject({ primaryTrackIndex: 1, translationTrackIndex: 0 });
  });

  it('normalizes a single SYLT-like tag containing translation-first duplicate timestamps', () => {
    const tags = [{
      descriptor: '', language: 'eng', contentType: 1, timeStampFormat: TimestampFormat.milliseconds,
      syncText: [
        { timestamp: 1000, text: '中文翻译' }, { timestamp: 1010, text: 'English original' },
        { timestamp: 5000, text: '下一句翻译' }, { timestamp: 5010, text: 'Next original line' },
      ],
    }];
    const result = normalizeEmbeddedLyrics(tags as any, { trackLanguage: 'eng' });
    expect(result.synced.lines.map(line => [line.text, line.translationText])).toEqual([
      ['English original', '中文翻译'], ['Next original line', '下一句翻译'],
    ]);
  });

  it('does not treat a mixed SYLT frame language as proof that its translated rows are primary', () => {
    const tags = [{
      descriptor: '', language: 'zho', contentType: 1, timeStampFormat: TimestampFormat.milliseconds,
      syncText: [
        { timestamp: 1000, text: 'I know what I want' }, { timestamp: 1010, text: '我知道我想要什么' },
        { timestamp: 5000, text: 'Never needed luck' }, { timestamp: 5010, text: '从不需要运气' },
      ],
    }];
    const result = normalizeEmbeddedLyrics(tags as any);
    expect(result.synced.lines.map(line => [line.text, line.translationText])).toEqual([
      ['I know what I want', '我知道我想要什么'], ['Never needed luck', '从不需要运气'],
    ]);
    expect(result.diagnostic.tracks[0]).toMatchObject({
      language: 'zho', descriptor: '', contentType: 1,
      timeStampFormat: TimestampFormat.milliseconds, synchronized: true, plain: false,
    });
  });

  it('preserves stable source order when descriptors and language metadata are ambiguous', () => {
    const tags = [
      { descriptor: '', language: '', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: 'first source track' }] },
      { descriptor: '', language: '', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1000, text: 'second source track' }] },
    ];
    const result = normalizeEmbeddedLyrics(tags as any);
    expect(result.synced.lines[0]).toMatchObject({ text: 'first source track', translationText: 'second source track' });
    expect(result.diagnostic.primaryReason).toBe('stable-source-order-fallback');
  });

  it('does not let credit-heavy synchronized metadata invert a complete lyric track', () => {
    const tags = [
      { descriptor: '', language: '', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [
        { timestamp: 0, text: '作词：A' }, { timestamp: 10, text: '作曲：B' }, { timestamp: 20, text: '编曲：C' },
      ] },
      { descriptor: '', language: '', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText: [
        { timestamp: 1000, text: 'original one' }, { timestamp: 5000, text: 'original two' },
      ] },
    ];
    const result = normalizeEmbeddedLyrics(tags as any);
    expect(result.diagnostic.primaryTrackIndex).toBe(1);
    expect(result.synced.lines[0].text).toBe('original one');
  });

  it('does not import through a file-only picker that would require copying audio bytes', async () => {
    const summary = await importLocalMediaFiles([new File(['audio'], 'no-handle.mp3', { type: 'audio/mpeg' })], {
      audio: { canPlayType: () => 'probably' },
      parse: (async () => parsed()) as any,
    });
    expect(summary).toMatchObject({ imported: 0, failed: 1 });
    expect(summary.items[0].message).toContain('未复制音频');
  });

  it('isolates an inaccessible selected handle instead of aborting the batch', async () => {
    const good = new File(['good'], 'good.mp3', { type: 'audio/mpeg' });
    const goodHandle = { kind: 'file', name: good.name } as WebFileSystemFileHandle;
    const missingHandle = { kind: 'file', name: 'missing.mp3' } as WebFileSystemFileHandle;
    Object.defineProperty(goodHandle, 'getFile', { enumerable: false, value: async () => good });
    Object.defineProperty(missingHandle, 'getFile', { enumerable: false, value: async () => { throw new DOMException('gone', 'NotFoundError'); } });
    const summary = await importLocalMediaHandles([
      goodHandle,
      missingHandle,
    ], { audio: { canPlayType: () => 'probably' }, parse: (async () => parsed()) as any });
    expect(summary).toMatchObject({ imported: 1, failed: 1 });
    expect(summary.items.find(item => item.filename === 'missing.mp3')?.message).toContain('重新授权/重新定位');
  });

  it('stores metadata, artwork and lyrics with a handle but no complete audio Blob', async () => {
    const file = new File(['audio'], 'reference.mp3', { type: 'audio/mpeg' });
    const summary = await importLocalMediaFiles([file], sourceOptions({
      audio: { canPlayType: () => 'probably' },
      parse: (async () => parsed({ common: {
        picture: [{ format: 'image/jpeg', type: 'Cover (front)', data: new Uint8Array([1, 2, 3]) }],
        lyrics: [{ contentType: 1, timeStampFormat: TimestampFormat.notSynchronized, syncText: [], text: '歌词' }],
      } })) as any,
    }));
    const record = summary.items[0].track;
    expect(record).toMatchObject({ schemaVersion: 2, sourceLifecycle: 'external-reference', metadata: { title: '标题' }, lyrics: { kind: 'plain' } });
    expect(record && 'audioBlob' in record).toBe(false);
    expect(record?.artworkBlob).toBeInstanceOf(Blob);
    expect(record?.schemaVersion === 2 && record.source.kind).toBe('web-file-handle');
  });
});
