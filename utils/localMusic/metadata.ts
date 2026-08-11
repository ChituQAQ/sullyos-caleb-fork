import { parseBlob, TimestampFormat, type IAudioMetadata, type ILyricsTag } from 'music-metadata';
import { attachTranslationTrack, chooseLyrics, foldBilingualTimedLines, isLyricCreditLine, parseLrc, plainLyrics } from './lyrics';
import { findLocalTrackByFingerprint, putLocalTrack, replaceLocalTrackLyrics } from './library';
import type {
  ImportItemResult, ImportSummary, LocalAudioExtension, LocalMediaRecord,
  LocalMediaSource, LyricsDocument, PlaybackCapability, TrackMetadata, WebFileSystemFileHandle,
} from './types';
import { LOCAL_AUDIO_EXTENSIONS } from './types';

const MIME_BY_EXTENSION: Record<LocalAudioExtension, string[]> = {
  mp3: ['audio/mpeg'],
  wav: ['audio/wav', 'audio/x-wav'],
  flac: ['audio/flac', 'audio/x-flac'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  aac: ['audio/aac', 'audio/mp4'],
  ogg: ['audio/ogg'],
  mp4: ['audio/mp4', 'video/mp4'],
};

export const extensionOf = (filename: string): string => filename.split('.').pop()?.toLowerCase() || '';
export const filenameTitle = (filename: string): string => filename.replace(/\.[^.]+$/, '') || filename;
export const basenameOf = (filename: string): string => filename.replace(/\.[^.]+$/, '').toLocaleLowerCase();

export function playbackCapability(file: Pick<File, 'name' | 'type'>, audio?: Pick<HTMLAudioElement, 'canPlayType'>): PlaybackCapability {
  const ext = extensionOf(file.name) as LocalAudioExtension;
  if (!LOCAL_AUDIO_EXTENSIONS.includes(ext)) return 'unsupported';
  if (!audio && typeof document !== 'undefined') audio = document.createElement('audio');
  if (!audio) return 'runtime-dependent';
  const candidates = [file.type, ...MIME_BY_EXTENSION[ext]].filter(Boolean);
  return candidates.some(type => audio!.canPlayType(type) !== '') ? 'supported' : 'unsupported';
}

export async function stableFileFingerprint(file: Pick<File, 'size' | 'slice'>): Promise<string> {
  const edge = 64 * 1024;
  const first = new Uint8Array(await file.slice(0, Math.min(edge, file.size)).arrayBuffer());
  const middleStart = Math.max(0, Math.floor(file.size / 2) - Math.floor(edge / 2));
  const middle = new Uint8Array(await file.slice(middleStart, Math.min(file.size, middleStart + edge)).arrayBuffer());
  const lastStart = Math.max(0, file.size - edge);
  const last = new Uint8Array(await file.slice(lastStart, file.size).arrayBuffer());
  const header = new TextEncoder().encode(`${file.size}:`);
  const combined = new Uint8Array(header.length + first.length + middle.length + last.length);
  combined.set(header);
  combined.set(first, header.length);
  combined.set(middle, header.length + first.length);
  combined.set(last, header.length + first.length + middle.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const TRANSLATION_DESCRIPTOR = /(?:translation|translated|\btrans\b|翻译|译文|中文翻译)/i;
const PRIMARY_DESCRIPTOR = /(?:original|\borig\b|\bmain\b|原文|原歌词|主歌词)/i;

const descriptorOf = (tag: ILyricsTag): string => `${tag.descriptor || ''} ${tag.language || ''}`.trim();
const isTranslationTag = (tag: ILyricsTag): boolean => TRANSLATION_DESCRIPTOR.test(descriptorOf(tag));
const isPrimaryTag = (tag: ILyricsTag): boolean => PRIMARY_DESCRIPTOR.test(descriptorOf(tag));

function syncedDocumentFromTag(tag: ILyricsTag | undefined, preferredLanguage?: string): LyricsDocument {
  const syncedLines: Array<{ timeMs: number; endTimeMs?: number; text: string }> = (tag?.syncText || [])
    .filter(line => Number.isFinite(line.timestamp) && line.text?.trim())
    .map(line => ({ timeMs: Math.max(0, line.timestamp || 0), text: line.text.trim() }))
    .sort((a, b) => a.timeMs - b.timeMs);
  if (syncedLines.length) return { kind: 'synced', source: 'embedded-synced', lines: foldBilingualTimedLines(syncedLines, preferredLanguage) };
  const lrc = tag?.text ? parseLrc(tag.text) : { kind: 'none', lines: [] } as LyricsDocument;
  return lrc.kind === 'synced' ? { ...lrc, source: 'embedded-synced' } : { kind: 'none', lines: [] };
}

export interface LyricNormalizationDiagnostic {
  trackCount: number;
  tracks: Array<{
    index: number; descriptor: string; language: string; contentType: number; timeStampFormat: number;
    synchronized: boolean; plain: boolean;
    lineCount: number; creditLineCount: number; previews: string[];
    primaryScore: number; translationScore: number; reasons: string[];
  }>;
  primaryTrackIndex: number | null;
  translationTrackIndex: number | null;
  primaryReason: string;
  translationReason: string;
}

const shortPreview = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 48);
const languageIdentity = (value?: string): string => {
  const normalized = (value || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  const aliases: Record<string, string> = {
    en: 'eng', eng: 'eng', zh: 'zho', zho: 'zho', chi: 'zho', cmn: 'zho',
    ko: 'kor', kor: 'kor', ja: 'jpn', jpn: 'jpn', fr: 'fra', fra: 'fra', fre: 'fra',
    de: 'deu', deu: 'deu', ger: 'deu', es: 'spa', spa: 'spa', it: 'ita', ita: 'ita',
  };
  return aliases[normalized] || normalized;
};
const languageMatches = (left?: string, right?: string): boolean => !!languageIdentity(left)
  && languageIdentity(left) === languageIdentity(right);

export function normalizeEmbeddedLyrics(
  tags: ILyricsTag[] | undefined,
  options: { trackLanguage?: string } = {},
): { synced: LyricsDocument; plain: LyricsDocument; diagnostic: LyricNormalizationDiagnostic } {
  const all = tags || [];
  const syncedTags = all.map((tag, sourceIndex) => ({ tag, sourceIndex })).filter(({ tag }) => (
    (tag.timeStampFormat === TimestampFormat.milliseconds && tag.syncText?.some(line => Number.isFinite(line.timestamp)))
    || (!!tag.text && parseLrc(tag.text).kind === 'synced')
  ));
  const analyses = syncedTags.map(({ tag, sourceIndex }, stableIndex) => {
    // A SYLT frame's language identifies the frame, not necessarily the primary
    // row inside bilingual same/near-timestamp content. Only file-level language
    // is strong enough to reorder rows within a mixed frame.
    const document = syncedDocumentFromTag(tag, options.trackLanguage);
    const lines = document.lines;
    const nonCreditCount = lines.filter(line => !isLyricCreditLine(line.text)).length;
    const reasons: string[] = [];
    let primaryScore = -stableIndex / 1000;
    let translationScore = -stableIndex / 1000;
    if (isPrimaryTag(tag)) { primaryScore += 1000; translationScore -= 1000; reasons.push('explicit-primary-descriptor'); }
    if (isTranslationTag(tag)) { primaryScore -= 1000; translationScore += 1000; reasons.push('explicit-translation-descriptor'); }
    if (languageMatches(tag.language, options.trackLanguage)) { primaryScore += 200; reasons.push('matches-track-language'); }
    if (lines.length > 0) {
      const creditRatio = (lines.length - nonCreditCount) / lines.length;
      primaryScore += Math.min(nonCreditCount, 100) / 100;
      primaryScore -= creditRatio * 100;
      if (creditRatio > 0) reasons.push('credit-rows-excluded-from-pairing');
      if (creditRatio >= 0.5) reasons.push('credit-heavy');
    }
    return { tag, sourceIndex, stableIndex, document, lines, nonCreditCount, primaryScore, translationScore, reasons };
  });
  const primaryAnalysis = [...analyses].sort((a, b) => b.primaryScore - a.primaryScore || a.stableIndex - b.stableIndex)[0];
  const primaryTag = primaryAnalysis?.tag;
  const primary = primaryAnalysis?.document || { kind: 'none', lines: [] } as LyricsDocument;
  const translationCandidates = analyses.filter(item => item !== primaryAnalysis).map(item => {
    const primaryTimed = primary.lines.filter(line => line.timeMs !== undefined && !isLyricCreditLine(line.text));
    const translatedTimed = item.lines.filter(line => line.timeMs !== undefined && !isLyricCreditLine(line.text));
    const paired = primaryTimed.filter(line => translatedTimed.some(candidate => Math.abs(candidate.timeMs! - line.timeMs!) <= 500)).length;
    const overlap = primaryTimed.length ? paired / primaryTimed.length : 0;
    item.translationScore += overlap * 100;
    if (overlap >= 0.6) item.reasons.push('timestamp-overlap');
    if (item.tag.language && primaryTag?.language && item.tag.language !== primaryTag.language) item.translationScore += 10;
    return item;
  });
  const translationAnalysis = [...translationCandidates]
    .filter(item => isTranslationTag(item.tag) || item.reasons.includes('timestamp-overlap'))
    .sort((a, b) => b.translationScore - a.translationScore || a.stableIndex - b.stableIndex)[0];
  const translationTag = translationAnalysis?.tag;
  const translation = translationAnalysis?.document || { kind: 'none', lines: [] } as LyricsDocument;
  const synced: LyricsDocument = translation.kind === 'synced'
    ? attachTranslationTrack(primary, translation)
    : primary;
  const plainTag = all.find(tag => !isTranslationTag(tag) && tag.text?.trim() && parseLrc(tag.text).kind !== 'synced')
    || all.find(tag => tag.text?.trim() && parseLrc(tag.text).kind !== 'synced');
  const plain = plainLyrics(plainTag?.text || '');
  const diagnostic: LyricNormalizationDiagnostic = {
    trackCount: all.length,
    tracks: all.map((tag, index) => {
      const item = analyses.find(candidate => candidate.sourceIndex === index);
      const plainDocument = tag.text ? parseLrc(tag.text) : { kind: 'none', lines: [] } as LyricsDocument;
      const previewLines = item?.lines || (plainDocument.kind === 'none' ? plainLyrics(tag.text || '').lines : plainDocument.lines);
      return {
        index,
        descriptor: tag.descriptor || '',
        language: tag.language || '',
        contentType: tag.contentType,
        timeStampFormat: tag.timeStampFormat,
        synchronized: item?.document.kind === 'synced',
        plain: !!tag.text?.trim() && plainDocument.kind !== 'synced',
        lineCount: previewLines.length,
        creditLineCount: previewLines.filter(line => isLyricCreditLine(line.text)).length,
        previews: previewLines.slice(0, 3).map(line => shortPreview(line.text)),
        primaryScore: item?.primaryScore || 0,
        translationScore: item?.translationScore || 0,
        reasons: item?.reasons || [],
      };
    }),
    primaryTrackIndex: primaryAnalysis?.sourceIndex ?? null,
    translationTrackIndex: translationAnalysis?.sourceIndex ?? null,
    primaryReason: primaryAnalysis?.reasons.join(',') || 'stable-source-order-fallback',
    translationReason: translationAnalysis?.reasons.join(',') || (translationAnalysis ? 'stable-source-order-fallback' : 'none'),
  };
  return { synced, plain, diagnostic };
}

export function metadataFromParser(file: File, parsed: IAudioMetadata, id: string): TrackMetadata {
  const picture = parsed.common.picture?.find(item => /front/i.test(item.type || '')) || parsed.common.picture?.[0];
  return {
    id,
    filename: file.name,
    title: parsed.common.title?.trim() || filenameTitle(file.name),
    artist: parsed.common.artist?.trim() || undefined,
    album: parsed.common.album?.trim() || undefined,
    albumArtist: parsed.common.albumartist?.trim() || undefined,
    durationMs: Number.isFinite(parsed.format.duration) ? Math.round((parsed.format.duration || 0) * 1000) : undefined,
    trackNumber: parsed.common.track?.no ?? undefined,
    discNumber: parsed.common.disk?.no ?? undefined,
    artwork: picture ? { mimeType: picture.format || 'image/jpeg', data: picture.data } : undefined,
    sourceFormat: extensionOf(file.name),
    codec: parsed.format.codec,
    container: parsed.format.container,
  };
}

function fallbackMetadata(file: File, id: string): TrackMetadata {
  return { id, filename: file.name, title: filenameTitle(file.name), sourceFormat: extensionOf(file.name) };
}

function numericSongId(id: string): number {
  return -Number.parseInt(id.slice(0, 12), 16);
}

export function localRecordToSong(record: LocalMediaRecord) {
  return {
    id: numericSongId(record.id),
    name: record.metadata.title,
    artists: record.metadata.artist || '未知歌手',
    album: record.metadata.album || '',
    albumPic: record.artworkBlob ? `xiafork-local-artwork:${record.id}` : '',
    duration: (record.metadata.durationMs || 0) / 1000,
    fee: 0,
    local: true,
    localLibraryTrackId: record.id,
    localMimeType: record.mimeType,
    localLyricsDocument: record.lyrics,
    localPlaybackCapability: record.playbackCapability,
    originalFilename: record.metadata.filename,
    albumArtist: record.metadata.albumArtist,
    trackNumber: record.metadata.trackNumber,
    discNumber: record.metadata.discNumber,
    sourceFormat: record.metadata.sourceFormat,
    codec: record.metadata.codec,
    container: record.metadata.container,
  };
}

export async function importLocalMediaFiles(
  files: File[],
  options: {
    audio?: Pick<HTMLAudioElement, 'canPlayType'>;
    parse?: typeof parseBlob;
    now?: () => number;
    sourceForFile?: (file: File) => LocalMediaSource | undefined;
  } = {},
): Promise<ImportSummary> {
  const lrcFiles = new Map(files.filter(file => extensionOf(file.name) === 'lrc').map(file => [basenameOf(file.name), file]));
  const audioFiles = files.filter(file => extensionOf(file.name) !== 'lrc');
  const items: ImportItemResult[] = [];
  for (const file of audioFiles) {
    const ext = extensionOf(file.name) as LocalAudioExtension;
    if (!LOCAL_AUDIO_EXTENSIONS.includes(ext)) {
      items.push({ filename: file.name, status: 'unsupported', message: '不支持的文件扩展名' });
      continue;
    }
    try {
      const source = options.sourceForFile?.(file);
      if (!source) {
        items.push({ filename: file.name, status: 'failed', message: '当前选择方式不能持久保存原文件授权，未复制音频' });
        continue;
      }
      const fingerprint = await stableFileFingerprint(file);
      const existing = await findLocalTrackByFingerprint(fingerprint);
      let parsed: IAudioMetadata | null = null;
      let warning: string | undefined;
      try {
        parsed = await (options.parse || parseBlob)(file, { duration: true, skipCovers: false });
      } catch (error) {
        warning = error instanceof Error ? error.message : 'metadata parse failed';
      }
      const metadata = parsed ? metadataFromParser(file, parsed, fingerprint) : fallbackMetadata(file, fingerprint);
      const embedded = normalizeEmbeddedLyrics(parsed?.common.lyrics, { trackLanguage: parsed?.common.language });
      if (import.meta.env.DEV && parsed?.common.lyrics?.length) {
        console.debug('[LocalLyrics] sanitized normalization diagnostic', embedded.diagnostic);
      }
      let external: LyricsDocument = { kind: 'none', lines: [] };
      const sidecar = lrcFiles.get(basenameOf(file.name));
      if (sidecar) {
        try { external = parseLrc(await sidecar.text()); } catch { /* batch isolation */ }
      }
      const selectedLyrics = chooseLyrics(embedded.synced, external, embedded.plain);
      if (existing) {
        // Re-import is an explicit user action. Refresh only normalized lyrics so
        // records created by an older normalizer can be repaired without touching
        // their source authorization, artwork, metadata, or audio lifecycle.
        if (selectedLyrics.kind !== 'none') await replaceLocalTrackLyrics(existing.id, selectedLyrics);
        items.push({ filename: file.name, status: 'duplicate', message: selectedLyrics.kind === 'none'
          ? '已在本地曲库中'
          : '已在本地曲库中，歌词已重新解析' });
        continue;
      }
      const capability = playbackCapability(file, options.audio);
      if (!parsed && capability === 'unsupported') {
        items.push({ filename: file.name, status: 'unsupported', message: `metadata 无法解析且当前 runtime 不支持 ${ext.toUpperCase()} 解码` });
        continue;
      }
      const { artwork, ...storedMetadata } = metadata;
      const artworkBytes = artwork ? artwork.data.slice().buffer as ArrayBuffer : undefined;
      const record: LocalMediaRecord = {
        schemaVersion: 2,
        id: fingerprint,
        fingerprint,
        importedAt: (options.now || Date.now)(),
        metadata: storedMetadata,
        artworkBlob: artwork && artworkBytes ? new Blob([artworkBytes], { type: artwork.mimeType }) : undefined,
        lyrics: selectedLyrics,
        source,
        mimeType: file.type || MIME_BY_EXTENSION[ext][0],
        playbackCapability: capability,
        metadataStatus: parsed ? 'parsed' : 'fallback',
        metadataWarning: warning,
        sourceLifecycle: 'external-reference',
      };
      const stored = await putLocalTrack(record);
      items.push(stored === 'duplicate'
        ? { filename: file.name, status: 'duplicate', message: '已在本地曲库中' }
        : { filename: file.name, status: 'imported', track: record, message: warning ? 'metadata 解析失败，已使用文件名' : undefined });
    } catch (error) {
      items.push({ filename: file.name, status: 'failed', message: error instanceof Error ? error.message : '导入失败' });
    }
  }
  return {
    imported: items.filter(item => item.status === 'imported').length,
    duplicates: items.filter(item => item.status === 'duplicate').length,
    unsupported: items.filter(item => item.status === 'unsupported').length,
    failed: items.filter(item => item.status === 'failed').length,
    metadataFallback: items.filter(item => item.track?.metadataStatus === 'fallback').length,
    destructiveChanges: 0,
    items,
  };
}

export async function importLocalMediaHandles(
  handles: WebFileSystemFileHandle[],
  options: Omit<Parameters<typeof importLocalMediaFiles>[1], 'sourceForFile'> = {},
): Promise<ImportSummary> {
  const selected: Array<{ handle: WebFileSystemFileHandle; file: File }> = [];
  const inaccessible: ImportItemResult[] = [];
  await Promise.all(handles.map(async handle => {
    try {
      selected.push({ handle, file: await handle.getFile() });
    } catch {
      inaccessible.push({ filename: handle.name, status: 'failed', message: '原文件不可访问，需要重新授权/重新定位' });
    }
  }));
  const handleByFile = new Map(selected.map(item => [item.file, item.handle]));
  const summary = await importLocalMediaFiles(selected.map(item => item.file), {
    ...options,
    sourceForFile: file => {
      const handle = handleByFile.get(file);
      return handle ? { kind: 'web-file-handle', handle } : undefined;
    },
  });
  return {
    ...summary,
    failed: summary.failed + inaccessible.length,
    items: [...summary.items, ...inaccessible],
  };
}
