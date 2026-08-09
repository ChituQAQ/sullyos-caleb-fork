import type { LyricsDocument, LyricsLine } from './types';

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIMESTAMP = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;
const OFFSET = /^\s*\[offset:([+-]?\d+)\]\s*$/i;
const METADATA = /^\s*\[(ar|al|ti|au|by|re|ve|length):.*\]\s*$/i;

export function parseLrc(text: string): LyricsDocument {
  let offsetMs = 0;
  let unsupportedExtraTiming = false;
  const pending: LyricsLine[] = [];

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const offset = OFFSET.exec(rawLine);
    if (offset) {
      offsetMs = Number(offset[1]) || 0;
      continue;
    }
    if (METADATA.test(rawLine)) continue;

    const matches = [...rawLine.matchAll(TIMESTAMP)];
    if (!matches.length) continue;
    const hasWordTiming = WORD_TIMESTAMP.test(rawLine);
    WORD_TIMESTAMP.lastIndex = 0;
    unsupportedExtraTiming ||= hasWordTiming;
    const lyricText = rawLine.replace(TIMESTAMP, '').replace(WORD_TIMESTAMP, '').trim();
    if (!lyricText) continue;
    for (const match of matches) {
      const fraction = match[3] || '0';
      const fractionMs = Number(fraction.padEnd(3, '0').slice(0, 3));
      pending.push({
        timeMs: Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + fractionMs,
        text: lyricText,
      });
    }
  }

  const lines = pending
    .map(line => ({ ...line, timeMs: Math.max(0, (line.timeMs || 0) + offsetMs) }))
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
  for (let index = 0; index < lines.length - 1; index += 1) {
    lines[index].endTimeMs = lines[index + 1].timeMs;
  }
  return lines.length
    ? { kind: 'synced', source: 'external-lrc', lines, unsupportedExtraTiming }
    : { kind: 'none', lines: [] };
}

export function plainLyrics(text: string): LyricsDocument {
  const lines = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(value => ({ text: value }));
  return lines.length ? { kind: 'plain', source: 'embedded-plain', lines } : { kind: 'none', lines: [] };
}

export function activeLyricIndex(document: LyricsDocument, positionMs: number): number {
  if (document.kind !== 'synced' || document.lines.length === 0) return -1;
  let low = 0;
  let high = document.lines.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if ((document.lines[middle].timeMs ?? Infinity) <= positionMs) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

export function lyricSeekTargetSeconds(line: LyricsLine): number | null {
  return line.timeMs === undefined ? null : line.timeMs / 1000;
}

export function chooseLyrics(
  embeddedSynced: LyricsDocument,
  external: LyricsDocument,
  embeddedPlain: LyricsDocument,
): LyricsDocument {
  if (embeddedSynced.kind === 'synced') return { ...embeddedSynced, source: 'embedded-synced' };
  if (external.kind === 'synced') return external;
  if (embeddedPlain.kind === 'plain') return embeddedPlain;
  return { kind: 'none', lines: [] };
}
