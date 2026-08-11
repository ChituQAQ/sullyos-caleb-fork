export const LOCAL_AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'mp4'] as const;

export type LocalAudioExtension = typeof LOCAL_AUDIO_EXTENSIONS[number];
export type PlaybackCapability = 'supported' | 'runtime-dependent' | 'unsupported';

export interface ArtworkData {
  mimeType: string;
  data: Uint8Array;
}
export interface LyricsLine {
  timeMs?: number;
  endTimeMs?: number;
  text: string;
  translationText?: string;
}

export interface LyricsDocument {
  kind: 'none' | 'plain' | 'synced';
  lines: LyricsLine[];
  source?: 'embedded-synced' | 'external-lrc' | 'embedded-plain';
  unsupportedExtraTiming?: boolean;
}

export interface TrackMetadata {
  id: string;
  filename: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  durationMs?: number;
  trackNumber?: number;
  discNumber?: number;
  artwork?: ArtworkData;
  sourceFormat: string;
  codec?: string;
  container?: string;
}

export interface WebFileSystemFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission?(descriptor?: { mode?: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(descriptor?: { mode?: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export interface WebFileSystemDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterableIterator<[string, WebFileSystemFileHandle | WebFileSystemDirectoryHandle]>;
  getFileHandle(name: string): Promise<WebFileSystemFileHandle>;
  getDirectoryHandle(name: string): Promise<WebFileSystemDirectoryHandle>;
  queryPermission?(descriptor?: { mode?: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(descriptor?: { mode?: 'read' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export interface LocalMediaSourceRoot {
  id: string;
  kind: 'web-directory-handle';
  name: string;
  importedAt: number;
  handle: WebFileSystemDirectoryHandle;
}

export type LocalMediaSource =
  | { kind: 'web-file-handle'; handle: WebFileSystemFileHandle }
  | { kind: 'web-directory-relative'; rootId: string; relativePath: string[] }
  | { kind: 'android-content-uri'; opaqueReference: string }
  | { kind: 'ios-security-scoped'; opaqueReference: string };

interface LocalMediaRecordBase {
  id: string;
  fingerprint: string;
  importedAt: number;
  metadata: Omit<TrackMetadata, 'artwork'>;
  artworkBlob?: Blob;
  lyrics: LyricsDocument;
  mimeType: string;
  playbackCapability: PlaybackCapability;
  metadataStatus: 'parsed' | 'fallback';
  metadataWarning?: string;
}

export interface LegacyBlobLocalMediaRecord extends LocalMediaRecordBase {
  schemaVersion: 1;
  audioBlob: Blob;
  sourceLifecycle: 'app-owned-blob-copy';
}

export interface ReferenceLocalMediaRecord extends LocalMediaRecordBase {
  schemaVersion: 2;
  source: LocalMediaSource;
  sourceLifecycle: 'external-reference';
}

export type LocalMediaRecord = LegacyBlobLocalMediaRecord | ReferenceLocalMediaRecord;

export interface ImportItemResult {
  filename: string;
  status: 'imported' | 'duplicate' | 'unsupported' | 'failed';
  track?: LocalMediaRecord;
  message?: string;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  unsupported: number;
  failed: number;
  metadataFallback: number;
  destructiveChanges: 0;
  items: ImportItemResult[];
}

export interface NowPlayingState {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  positionMs: number;
  isPlaying: boolean;
  source: 'local';
}
