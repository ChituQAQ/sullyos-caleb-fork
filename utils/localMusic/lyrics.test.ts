import { describe, expect, it } from 'vitest';
import { activeLyricIndex, attachTranslationTrack, chooseLyrics, foldBilingualTimedLines, lyricSeekTargetSeconds, parseLrc, plainLyrics } from './lyrics';

describe('local music lyrics normalization', () => {
  it('keeps plain lyrics untimed', () => {
    expect(plainLyrics('第一行\n\n第二行')).toEqual({
      kind: 'plain', source: 'embedded-plain', lines: [{ text: '第一行' }, { text: '第二行' }],
    });
  });

  it('parses common LRC timestamps, multiple timestamps, metadata and offset', () => {
    const result = parseLrc('[ar:Artist]\n[offset:+120]\n[00:01.20][00:02.345]你好\n[00:03:50]世界');
    expect(result.kind).toBe('synced');
    expect(result.lines.map(line => [line.timeMs, line.text])).toEqual([
      [1320, '你好'], [2465, '你好'], [3620, '世界'],
    ]);
    expect(result.lines[0].endTimeMs).toBe(2465);
  });

  it('ignores malformed and enhanced word-timing-only lines instead of inventing timing', () => {
    const result = parseLrc('[bad]\n<00:01.00>word timing\nplain text');
    expect(result).toEqual({ kind: 'none', lines: [] });
  });

  it('safely degrades enhanced word timing to clean line-level lyrics', () => {
    const result = parseLrc('[00:01.00]<00:01.00>逐<00:01.20>字');
    expect(result).toMatchObject({ kind: 'synced', unsupportedExtraTiming: true });
    expect(result.lines[0]).toMatchObject({ timeMs: 1000, text: '逐字' });
  });

  it('uses embedded synced, external LRC, embedded plain precedence', () => {
    const embeddedSynced = parseLrc('[00:01.00]embedded');
    const external = parseLrc('[00:02.00]external');
    const plain = plainLyrics('plain');
    expect(chooseLyrics(embeddedSynced, external, plain).lines[0].text).toBe('embedded');
    expect(chooseLyrics({ kind: 'none', lines: [] }, external, plain).lines[0].text).toBe('external');
    expect(chooseLyrics({ kind: 'none', lines: [] }, { kind: 'none', lines: [] }, plain).kind).toBe('plain');
  });

  it('finds the active line immediately after seek', () => {
    const document = parseLrc('[00:01.00]one\n[00:05.00]two\n[00:09.00]three');
    expect(activeLyricIndex(document, 500)).toBe(-1);
    expect(activeLyricIndex(document, 6_000)).toBe(1);
    expect(document.lines[1].timeMs).toBe(5_000);
    expect(lyricSeekTargetSeconds(document.lines[1])).toBe(5);
    expect(lyricSeekTargetSeconds({ text: 'plain' })).toBeNull();
  });

  it.each([
    ['English original', '中文翻译'],
    ['中文原文', 'English translation'],
    ['한국어 원문', '中文翻译'],
  ])('pairs duplicate-timestamp bilingual rows with the first source row primary: %s', (primary, translation) => {
    const document = parseLrc(`[00:01.00]${primary}\n[00:01.00]${translation}\n[00:05.00]next`);
    expect(document.lines).toHaveLength(2);
    expect(document.lines[0]).toMatchObject({ timeMs: 1000, text: primary, translationText: translation });
    expect(activeLyricIndex(document, 1100)).toBe(0);
  });

  it('keeps a single-language document as one row per timestamp', () => {
    const document = parseLrc('[00:01.00]第一句\n[00:05.00]第二句');
    expect(document.lines.map(line => line.translationText)).toEqual([undefined, undefined]);
  });

  it('attaches a separately synchronized translated track without making it active', () => {
    const primary = parseLrc('[00:01.00]original\n[00:05.00]next');
    const translation = parseLrc('[00:01.10]译文\n[00:05.10]下一句');
    const document = attachTranslationTrack(primary, translation);
    expect(document.lines.map(line => [line.text, line.translationText])).toEqual([
      ['original', '译文'], ['next', '下一句'],
    ]);
    expect(activeLyricIndex(document, 5200)).toBe(1);
  });

  it('pairs near-identical synchronized rows within the conservative tolerance', () => {
    expect(foldBilingualTimedLines([
      { timeMs: 12340, text: 'original' },
      { timeMs: 12350, text: '翻译' },
    ])).toEqual([{ timeMs: 12340, text: 'original', translationText: '翻译' }]);
  });

  it('does not collapse two rapid same-script primary lines merely because they are close', () => {
    expect(foldBilingualTimedLines([
      { timeMs: 12340, text: 'wait' },
      { timeMs: 12450, text: 'go' },
    ])).toMatchObject([
      { timeMs: 12340, text: 'wait' },
      { timeMs: 12450, text: 'go' },
    ]);
  });

  it('uses declared primary language inside one mixed synchronized track', () => {
    expect(foldBilingualTimedLines([
      { timeMs: 1000, text: '中文翻译' },
      { timeMs: 1010, text: 'English original' },
    ], 'eng')[0]).toMatchObject({ text: 'English original', translationText: '中文翻译' });
  });

  it('does not pair credit metadata into a bilingual lyric row', () => {
    const lines = foldBilingualTimedLines([
      { timeMs: 0, text: '作词：Yves' },
      { timeMs: 10, text: 'Composer: Yves' },
      { timeMs: 1000, text: 'original lyric' },
      { timeMs: 1010, text: '翻译歌词' },
    ], 'eng');
    expect(lines.slice(0, 2).map(line => line.text)).toEqual(['作词：Yves', 'Composer: Yves']);
    expect(lines[2]).toMatchObject({ text: 'original lyric', translationText: '翻译歌词' });
  });
});
