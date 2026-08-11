import type { LyricsDocument, LyricsLine } from './types';

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIMESTAMP = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;
const OFFSET = /^\s*\[offset:([+-]?\d+)\]\s*$/i;
const METADATA = /^\s*\[(ar|al|ti|au|by|re|ve|length):.*\]\s*$/i;
const CREDIT_LINE = /^\s*(?:作词|作曲|编曲|制作人|监制|混音|母带|翻译|译者|lyric(?:s|ist)?|composer|arranger|producer|translated\s+by)\s*[:：]/i;

export const isLyricCreditLine = (text: string): boolean => CREDIT_LINE.test(text);

type ScriptFamily = 'han' | 'latin' | 'hangul' | 'kana' | 'other';
const scriptFamily = (text: string): ScriptFamily => {
  const visible = text.replace(/[\s\p{P}\p{N}\p{S}]/gu, '');
  if (!visible) return 'other';
  const count = (pattern: RegExp) => [...visible].filter(char => pattern.test(char)).length;
  const scores: Array<[ScriptFamily, number]> = [
    ['hangul', count(/[\p{Script=Hangul}]/u)],
    ['kana', count(/[\p{Script=Hiragana}\p{Script=Katakana}]/u)],
    ['han', count(/[\p{Script=Han}]/u)],
    ['latin', count(/[\p{Script=Latin}]/u)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] / [...visible].length >= 0.45 ? scores[0][0] : 'other';
};

const languageFamily = (language?: string): ScriptFamily | undefined => {
  const value = (language || '').toLowerCase();
  if (/^(?:zh|zho|chi|cmn)/.test(value)) return 'han';
  if (/^(?:ko|kor)/.test(value)) return 'hangul';
  if (/^(?:ja|jpn)/.test(value)) return 'kana';
  if (/^(?:en|eng|fr|fra|fre|es|spa|de|deu|ger|it|ita|pt|por)/.test(value)) return 'latin';
  return undefined;
};

const primaryInPair = (pair: LyricsLine[], preferredLanguage?: string): LyricsLine => {
  const preferred = languageFamily(preferredLanguage);
  if (preferred) {
    const matches = pair.filter(line => scriptFamily(line.text) === preferred);
    if (matches.length === 1) return matches[0];
  }
  // Ambiguous data must preserve source order; script alone never means translation.
  return pair[0];
};

export function foldBilingualTimedLines(input: LyricsLine[], preferredLanguage?: string): LyricsLine[] {
  const ordered = input.map((line, order) => ({ ...line, order }))
    .sort((a, b) => ((a.timeMs || 0) - (b.timeMs || 0)) || a.order - b.order);
  const lines: LyricsLine[] = [];
  for (let index = 0; index < ordered.length;) {
    const first = ordered[index];
    const group = [first];
    let next = index + 1;
    while (next < ordered.length && Math.abs((ordered[next].timeMs || 0) - (first.timeMs || 0)) <= 200) {
      group.push(ordered[next]);
      next += 1;
    }
    const exactTimestamp = group.length === 2 && group[0].timeMs === group[1].timeMs;
    const differentScripts = group.length === 2
      && scriptFamily(group[0].text) !== 'other'
      && scriptFamily(group[1].text) !== 'other'
      && scriptFamily(group[0].text) !== scriptFamily(group[1].text);
    const preferred = languageFamily(preferredLanguage);
    const hasSinglePreferredMatch = group.length === 2 && !!preferred
      && group.filter(line => scriptFamily(line.text) === preferred).length === 1;
    if (group.length === 2 && !group.some(line => isLyricCreditLine(line.text))
      && (exactTimestamp || differentScripts || hasSinglePreferredMatch)) {
      const primary = primaryInPair(group, preferredLanguage);
      const translation = group.find(line => line !== primary)!;
      lines.push({ timeMs: primary.timeMs, text: primary.text, translationText: translation.text });
    } else {
      lines.push(...group.map(({ order: _order, ...line }) => line));
    }
    index = next;
  }
  for (let index = 0; index < lines.length - 1; index += 1) lines[index].endTimeMs = lines[index + 1].timeMs;
  return lines;
}

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

  const ordered = pending
    .map(line => ({ ...line, timeMs: Math.max(0, (line.timeMs || 0) + offsetMs) }))
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
  const lines = foldBilingualTimedLines(ordered);
  return lines.length
    ? { kind: 'synced', source: 'external-lrc', lines, unsupportedExtraTiming }
    : { kind: 'none', lines: [] };
}

export function attachTranslationTrack(primary: LyricsDocument, translation: LyricsDocument): LyricsDocument {
  if (primary.kind !== 'synced' || translation.kind !== 'synced') return primary;
  const translated = primary.lines.map(line => {
    if (line.timeMs === undefined) return line;
    let best: LyricsLine | undefined;
    let bestDistance = Infinity;
    if (isLyricCreditLine(line.text)) return line;
    for (const candidate of translation.lines) {
      if (candidate.timeMs === undefined) continue;
      if (isLyricCreditLine(candidate.text)) continue;
      const distance = Math.abs(candidate.timeMs - line.timeMs);
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    return best && bestDistance <= 500 ? { ...line, translationText: best.text } : line;
  });
  return { ...primary, lines: translated };
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
