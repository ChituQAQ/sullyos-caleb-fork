import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('M4 acceptance player and artwork wiring', () => {
  it('uses the shared artwork resolver in chat floating and expanded player surfaces', () => {
    const global = source('components/os/GlobalMiniPlayer.tsx');
    expect(global).toContain('useBlobRefUrl(current?.albumPic)');
    expect(global).not.toMatch(/src=\{current\.albumPic\}/);
    expect(global.match(/src=\{resolvedAlbumPic\}/g)).toHaveLength(2);
  });

  it('resolves artwork on official MUSIC_ACTION chat cards', () => {
    const message = source('components/chat/MessageItem.tsx');
    expect(message).toContain('const MusicCardArtwork');
    expect(message).toContain('useBlobRefUrl(value)');
    expect(message).toContain('<MusicCardArtwork value={song.albumPic} />');
    expect(message).not.toContain('src={song.albumPic}');
  });

  it('uses the shared artwork resolver for all desktop widget image and background slots', () => {
    const widget = source('components/os/NowPlayingSquareWidget.tsx');
    expect(widget).toContain('useBlobRefUrl(current?.albumPic)');
    expect(widget).not.toMatch(/src=\{current\??\.albumPic\}/);
  });

  it('keeps all MusicApp current-track artwork behind MusicUI shared resolution', () => {
    const ui = source('apps/music/MusicUI.tsx');
    expect(ui.match(/useBlobRefUrl\(albumPic\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(ui).not.toContain('src={albumPic}');
  });

  it('restores official-like full player chrome while retaining lyric interaction', () => {
    const app = source('apps/MusicApp.tsx');
    expect(app).not.toContain('aria-label="和谁一起听"');
    expect(app).not.toContain('aria-label="音量"');
    expect(app).toContain('fullArtwork={!!current.localLibraryTrackId}');
    expect(app).toContain('grid-cols-[12px_minmax(0,1fr)_12px]');
    expect(app).toContain('lyricSeekTargetSeconds');
    expect(app).toContain('回到当前歌词');
    expect(app).toContain('重新授权 / 重新定位原文件');
    expect(app).toContain('导入音乐文件夹');
    expect(app).toContain("useState<LyricFollowMode>('following')");
    expect(app).toContain('translationText');
  });

  it('preserves engine volume support outside the removed player UI', () => {
    expect(source('utils/localMusic/playbackEngine.ts')).toContain('setVolume(volume: number)');
    expect(source('context/MusicContext.tsx')).toContain('setVolume: (volume: number) => void');
  });

  it('derives every player surface from MusicContext playing state', () => {
    const context = source('context/MusicContext.tsx');
    expect(context).toContain("const playing = playbackState === 'playing'");
    expect(context).not.toContain('setPlaying(');
    for (const path of [
      'apps/MusicApp.tsx', 'apps/music/MusicUI.tsx',
      'components/os/GlobalMiniPlayer.tsx', 'components/os/NowPlayingSquareWidget.tsx',
    ]) {
      expect(source(path)).toMatch(/\bplaying\b/);
    }
  });
});
