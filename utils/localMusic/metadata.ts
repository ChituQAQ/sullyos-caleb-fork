import { parseBlob, TimestampFormat, type IAudioMetadata, type ILyricsTag } from 'music-metadata';
import { chooseLyrics, parseLrc, plainLyrics } from './lyrics';
import { findLocalTrackByFingerprint, putLocalTrack } from './library';
import type {
  ImportItemResult, ImportSummary, LocalAudioExtension, LocalMediaRecord,
  LyricsDocument, PlaybackCapability, TrackMetadata,
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

function normalizedEmbeddedLyrics(tags: ILyricsTag[] | undefined): { synced: LyricsDocument; plain: LyricsDocument } {
  const syncedTag = tags?.find(tag => tag.timeStampFormat === TimestampFormat.milliseconds && tag.syncText?.some(line => Number.isFinite(line.timestamp)));
  const syncedLines: Array<{ timeMs: number; endTimeMs?: number; text: string }> = (syncedTag?.syncText || [])
    .filter(line => Number.isFinite(line.timestamp) && line.text?.trim())
    .map(line => ({ timeMs: Math.max(0, line.timestamp || 0), text: line.text.trim() }))
    .sort((a, b) => a.timeMs - b.timeMs);
  for (let index = 0; index < syncedLines.length - 1; index += 1) syncedLines[index].endTimeMs = syncedLines[index + 1].timeMs;
  const embeddedLrc = tags?.map(tag => tag.text || '').find(text => parseLrc(text).kind === 'synced');
  const lrc = embeddedLrc ? parseLrc(embeddedLrc) : { kind: 'none', lines: [] } as LyricsDocument;
  const synced: LyricsDocument = syncedLines.length
    ? { kind: 'synced', source: 'embedded-synced', lines: syncedLines }
    : lrc.kind === 'synced' ? { ...lrc, source: 'embedded-synced' } : { kind: 'none', lines: [] };
  const plainText = tags?.map(tag => tag.text || '').find(text => text.trim() && parseLrc(text).kind !== 'synced') || '';
  return { synced, plain: plainLyrics(plainText) };
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
  options: { audio?: Pick<HTMLAudioElement, 'canPlayType'>; parse?: typeof parseBlob; now?: () => number } = {},
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
      const fingerprint = await stableFileFingerprint(file);
      if (await findLocalTrackByFingerprint(fingerprint)) {
        items.push({ filename: file.name, status: 'duplicate', message: '已在本地曲库中' });
        continue;
      }
      let parsed: IAudioMetadata | null = null;
      let warning: string | undefined;
      try {
        parsed = await (options.parse || parseBlob)(file, { duration: true, skipCovers: false });
      } catch (error) {
        warning = error instanceof Error ? error.message : 'metadata parse failed';
      }
      const metadata = parsed ? metadataFromParser(file, parsed, fingerprint) : fallbackMetadata(file, fingerprint);
      const embedded = normalizedEmbeddedLyrics(parsed?.common.lyrics);
      let external: LyricsDocument = { kind: 'none', lines: [] };
      const sidecar = lrcFiles.get(basenameOf(file.name));
      if (sidecar) {
        try { external = parseLrc(await sidecar.text()); } catch { /* batch isolation */ }
      }
      const capability = playbackCapability(file, options.audio);
      if (!parsed && capability === 'unsupported') {
        items.push({ filename: file.name, status: 'unsupported', message: `metadata 无法解析且当前 runtime 不支持 ${ext.toUpperCase()} 解码` });
        continue;
      }
      const { artwork, ...storedMetadata } = metadata;
      const artworkBytes = artwork ? artwork.data.slice().buffer as ArrayBuffer : undefined;
      const record: LocalMediaRecord = {
        schemaVersion: 1,
        id: fingerprint,
        fingerprint,
        importedAt: (options.now || Date.now)(),
        metadata: storedMetadata,
        artworkBlob: artwork && artworkBytes ? new Blob([artworkBytes], { type: artwork.mimeType }) : undefined,
        lyrics: chooseLyrics(embedded.synced, external, embedded.plain),
        audioBlob: file.slice(0, file.size, file.type || MIME_BY_EXTENSION[ext][0]),
        mimeType: file.type || MIME_BY_EXTENSION[ext][0],
        playbackCapability: capability,
        metadataStatus: parsed ? 'parsed' : 'fallback',
        metadataWarning: warning,
        sourceLifecycle: 'app-owned-blob-copy',
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
