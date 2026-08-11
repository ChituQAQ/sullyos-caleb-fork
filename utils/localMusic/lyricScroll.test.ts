import { describe, expect, it, vi } from 'vitest';
import { beginLyricBrowsing, commitTimedLyricSeek, followActiveLyric, returnToLyricFollowing, type LyricFollowMode } from './lyricScroll';

const fakeDom = () => {
  const scrollTo = vi.fn();
  const box = { scrollTop: 1200, scrollHeight: 4000, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }), scrollTo };
  const active = { clientHeight: 40, getBoundingClientRect: () => ({ top: 900 }) };
  return { box, active, scrollTo };
};

describe('lyric native-scroll state seam', () => {
  it('FOLLOWING recenters the active DOM row', () => {
    const { box, active, scrollTo } = fakeDom();
    expect(followActiveLyric('following', box, active)).toBe(1870);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1870, behavior: 'auto' });
  });

  it('BROWSING preserves a user scroll position far from the active row across updates', () => {
    const { box, active, scrollTo } = fakeDom();
    const userPosition = box.scrollTop;
    for (let activeLyricIdx = 1; activeLyricIdx < 20; activeLyricIdx += 1) {
      expect(followActiveLyric('browsing', box, active)).toBeNull();
    }
    expect(scrollTo).not.toHaveBeenCalled();
    expect(box.scrollTop).toBe(userPosition);
  });

  it.each(['wheel', 'touchstart', 'pointerdown'])('%s intent enters BROWSING without a timeout or scroll mutation', () => {
    const { box, scrollTo } = fakeDom();
    const before = box.scrollTop;
    const mode = beginLyricBrowsing();
    expect(mode).toBe('browsing');
    expect(box.scrollTop).toBe(before);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('explicit return is the only non-seek transition back to FOLLOWING', () => {
    expect(returnToLyricFollowing()).toBe('following');
  });

  it('explicit return restores following and a future-row click seeks once', () => {
    const seek = vi.fn();
    let mode: LyricFollowMode = 'browsing';
    mode = commitTimedLyricSeek(198.25, seek);
    expect(seek).toHaveBeenCalledOnce();
    expect(seek).toHaveBeenCalledWith(198.25);
    expect(mode).toBe('following');
    const { box, active, scrollTo } = fakeDom();
    followActiveLyric(mode, box, active);
    expect(scrollTo).toHaveBeenCalledOnce();
  });
});
