export type LyricFollowMode = 'following' | 'browsing';

export function beginLyricBrowsing(): LyricFollowMode {
  return 'browsing';
}

export function returnToLyricFollowing(): LyricFollowMode {
  return 'following';
}

export interface ScrollBoxLike {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect(): { top: number };
  scrollTo(options: { top: number; behavior?: ScrollBehavior }): void;
}

export interface LyricRowLike {
  clientHeight: number;
  getBoundingClientRect(): { top: number };
}

/** Pure, DOM-shaped seam used by MusicApp and the no-layout-engine regression tests. */
export function followActiveLyric(
  mode: LyricFollowMode,
  box: ScrollBoxLike,
  row: LyricRowLike,
): number | null {
  if (mode !== 'following') return null;
  const topInBox = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const target = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, topInBox - box.clientHeight / 2 + row.clientHeight / 2));
  box.scrollTo({
    top: target,
    // Instant positioning cannot keep animating after the user starts a native gesture.
    behavior: 'auto',
  });
  return target;
}

export function commitTimedLyricSeek(timeSeconds: number | undefined, seek: (seconds: number) => void): LyricFollowMode {
  if (timeSeconds !== undefined && Number.isFinite(timeSeconds)) seek(Math.max(0, timeSeconds));
  return returnToLyricFollowing();
}
