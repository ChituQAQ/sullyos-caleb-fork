import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../apps/MusicApp.tsx', import.meta.url)),
  'utf8',
);
const musicContextSource = readFileSync(
  fileURLToPath(new URL('../context/MusicContext.tsx', import.meta.url)),
  'utf8',
);

describe('Music app navigation', () => {
  it('opens on the search landing page where local music and NetEase are both reachable', () => {
    expect(source).toContain("useState<View>('search')");
    expect(source).toMatch(/title="本地音乐"[\s\S]{0,200}<FolderOpen/);
    expect(source).toContain("onClick={() => setView('profile')}");
  });

  it('mounts the local library and exposes its import action', () => {
    expect(source).toContain("{view === 'local' && renderLocalLibrary()}");
    expect(source).toContain('导入音乐文件夹');
    expect(source).toContain('导入单曲 / LRC');
  });

  it('returns from local, profile, and settings views to the landing page', () => {
    expect(source.match(/onBack=\{\(\) => setView\('search'\)\}/g)).toHaveLength(3);
  });

  it('renders every lyric entry as a full-width row in a centered readable column', () => {
    expect(source).toContain('className="flex w-full flex-col items-center gap-4 py-[30vh]"');
    expect(source).toContain('className="block w-full max-w-2xl px-2 transition-transform duration-300 will-change-transform"');
    expect(source).toContain('grid-cols-[12px_minmax(0,1fr)_12px]');
    expect(source).toContain('whitespace-normal text-center');
  });

  it('keeps timed seek, translation attachment, and transform-only highlighting wired', () => {
    expect(source).toContain('if (target === null) return;');
    expect(source).toContain('commitTimedLyricSeek(target, seekSeconds)');
    expect(source).toContain('{translationText && (');
    expect(source).toContain("transform: active ? 'scale(1.05)' : 'scale(1)'");
  });

  it('keeps full timed lyrics mounted and uses an explicit no-timeout browse state', () => {
    expect(source).toContain("useState<LyricFollowMode>('following')");
    expect(source).toContain('onWheel={enterLyricBrowseMode}');
    expect(source).toContain('onTouchStart={enterLyricBrowseMode}');
    expect(source).toContain('onPointerDown={enterLyricBrowseMode}');
    expect(source).toContain('flex-1 min-h-0 flex flex-col items-center');
    expect(source).toContain("touchAction: 'pan-y'");
    expect(source).toContain('programmaticLyricScrollTargetRef.current');
    expect(source).toContain("followActiveLyric('following', box, el)");
    expect(source).toContain('className="absolute inset-0 overflow-y-scroll pointer-events-auto');
    expect(source).not.toContain('querySelectorAll<HTMLElement>');
    expect(source).not.toMatch(/setTimeout\([\s\S]{0,120}setLyricFollowMode/);
  });

  it('keeps official MiniPlayer companion display without a full-player selector', () => {
    expect(source).not.toContain('aria-label="和谁一起听"');
    expect(source).toContain('listeningTogetherWith');
    expect(source).toContain('companions={companions}');
    expect(source).toContain('onKickCompanion={charId => { removeListeningPartner(charId)');
  });

  it('clears selected character ids when the track changes', () => {
    expect(musicContextSource).toMatch(/previousSong\.id !== current\?\.id[\s\S]{0,500}setListeningTogetherWith\(\[\]\)/);
  });

  it('has no second global Together Listening source of truth', () => {
    expect(source).not.toContain('togetherListeningEnabled');
    expect(musicContextSource).not.toContain('togetherListeningEnabled');
  });
});
