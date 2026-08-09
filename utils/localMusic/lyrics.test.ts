import { describe, expect, it } from 'vitest';
import { activeLyricIndex, chooseLyrics, lyricSeekTargetSeconds, parseLrc, plainLyrics } from './lyrics';

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
});
