import type { NowPlayingState } from './types';

export function createNowPlayingState(input: {
  trackId: string;
  title: string;
  artist?: string;
  album?: string;
  durationSeconds: number;
  positionSeconds: number;
  isPlaying: boolean;
}): NowPlayingState {
  return {
    trackId: input.trackId,
    title: input.title,
    artist: input.artist || '未知歌手',
    album: input.album || undefined,
    durationMs: Math.max(0, Math.round(input.durationSeconds * 1000)),
    positionMs: Math.max(0, Math.round(input.positionSeconds * 1000)),
    isPlaying: input.isPlaying,
    source: 'local',
  };
}

export interface TogetherListeningContext {
  title: string;
  artist: string;
  album?: string;
  status: 'playing' | 'paused';
  source: 'local';
}

export function getTogetherListeningContext(
  hasCurrentLocalTrack: boolean,
  nowPlaying: NowPlayingState | null | undefined,
): TogetherListeningContext | null {
  if (!hasCurrentLocalTrack || !nowPlaying) return null;
  return {
    title: nowPlaying.title,
    artist: nowPlaying.artist,
    album: nowPlaying.album || undefined,
    status: nowPlaying.isPlaying ? 'playing' : 'paused',
    source: 'local',
  };
}

export function formatTogetherListeningContext(context: TogetherListeningContext | null): string {
  if (!context) return '';
  return [
    '用户正在通过 SullyOS 本地音乐播放器听歌。',
    `标题：${context.title}`,
    `歌手：${context.artist || '未知歌手'}`,
    context.album ? `专辑：${context.album}` : '',
    `状态：${context.status === 'playing' ? '正在播放' : '已暂停'}`,
  ].filter(Boolean).join('\n');
}
