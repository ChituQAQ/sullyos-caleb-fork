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

export interface LocalMediaRecord {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  importedAt: number;
  metadata: Omit<TrackMetadata, 'artwork'>;
  artworkBlob?: Blob;
  lyrics: LyricsDocument;
  audioBlob: Blob;
  mimeType: string;
  playbackCapability: PlaybackCapability;
  metadataStatus: 'parsed' | 'fallback';
  metadataWarning?: string;
  sourceLifecycle: 'app-owned-blob-copy';
}

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
