import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importLocalMediaDirectory, scanLocalMusicDirectory } from './directoryImport';
import { listLocalMediaSourceRoots, listLocalTracks, removeLocalTrack } from './library';
import type { WebFileSystemDirectoryHandle, WebFileSystemFileHandle } from './types';

const fileHandle = (name: string, body = 'audio'): WebFileSystemFileHandle => {
  const handle = { kind: 'file', name } as WebFileSystemFileHandle;
  Object.defineProperty(handle, 'getFile', { enumerable: false, value: async () => new File([body], name, { type: name.endsWith('.lrc') ? 'text/plain' : 'audio/mpeg' }) });
  return handle;
};

const directoryHandle = (
  name: string,
  children: Record<string, WebFileSystemFileHandle | WebFileSystemDirectoryHandle>,
): WebFileSystemDirectoryHandle => {
  const handle = { kind: 'directory', name } as WebFileSystemDirectoryHandle;
  Object.defineProperties(handle, {
    entries: { enumerable: false, value: async function* () { for (const entry of Object.entries(children)) yield entry; } },
    getFileHandle: { enumerable: false, value: async (child: string) => {
      const found = children[child];
      if (!found || found.kind !== 'file') throw new DOMException('missing', 'NotFoundError');
      return found;
    } },
    getDirectoryHandle: { enumerable: false, value: async (child: string) => {
      const found = children[child];
      if (!found || found.kind !== 'directory') throw new DOMException('missing', 'NotFoundError');
      return found;
    } },
  });
  return handle;
};

describe('directory-reference music import', () => {
  beforeEach(async () => {
    for (const item of await listLocalTracks()) await removeLocalTrack(item.id);
  });

  it('recurses nested folders, ignores unsupported files and retains relative paths', async () => {
    const root = directoryHandle('Music', {
      Artist: directoryHandle('Artist', {
        Album: directoryHandle('Album', {
          'song.mp3': fileHandle('song.mp3'),
          'song.lrc': fileHandle('song.lrc', '[00:01.00]歌词'),
          'cover.jpg': fileHandle('cover.jpg'),
        }),
      }),
    });
    const scanned = await scanLocalMusicDirectory(root);
    expect(scanned.map(item => item.relativePath.join('/')).sort()).toEqual([
      'Artist/Album/song.lrc', 'Artist/Album/song.mp3',
    ]);
  });

  it('matches a same-directory LRC and stores only root id plus relative path for audio', async () => {
    const progress = vi.fn();
    const root = directoryHandle('Music', {
      Album: directoryHandle('Album', {
        'song.mp3': fileHandle('song.mp3'),
        'song.lrc': fileHandle('song.lrc', '[00:01.00]原文\n[00:01.00]translation'),
        'broken.mp3': { kind: 'file', name: 'broken.mp3', getFile: async () => { throw new Error('gone'); } },
      }),
    });
    const result = await importLocalMediaDirectory(root, {
      rootId: 'root-test',
      onProgress: progress,
      audio: { canPlayType: () => 'probably' },
      parse: (async () => ({ format: { duration: 10 }, common: {}, native: {}, quality: { warnings: [] } })) as any,
      now: () => 123,
    });
    expect(result.summary).toMatchObject({ imported: 1, failed: 1 });
    const track = result.summary.items.find(item => item.filename === 'song.mp3')?.track;
    expect(track).toMatchObject({
      schemaVersion: 2,
      sourceLifecycle: 'external-reference',
      source: { kind: 'web-directory-relative', rootId: 'root-test', relativePath: ['Album', 'song.mp3'] },
      lyrics: { kind: 'synced', lines: [{ text: '原文', translationText: 'translation' }] },
    });
    expect(track && 'audioBlob' in track).toBe(false);
    expect(await listLocalMediaSourceRoots()).toContainEqual(expect.objectContaining({
      id: 'root-test', kind: 'web-directory-handle', name: 'Music', handle: expect.objectContaining({ kind: 'directory', name: 'Music' }),
    }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'importing', total: 3 }));
  });
});
