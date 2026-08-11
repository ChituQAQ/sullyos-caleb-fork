import { describe, expect, it, vi } from 'vitest';
import { LocalMediaSourceAccessError, resolveLocalMediaRecord, resolveLocalMediaSource, supportsPersistentWebDirectoryHandles, supportsPersistentWebFileHandles } from './sourceResolver';
import type { LegacyBlobLocalMediaRecord, LocalMediaSourceRoot, ReferenceLocalMediaRecord, WebFileSystemDirectoryHandle, WebFileSystemFileHandle } from './types';

const referenceRecord = (handle: WebFileSystemFileHandle): ReferenceLocalMediaRecord => ({
  schemaVersion: 2,
  id: 'ref', fingerprint: 'ref', importedAt: 1,
  metadata: { id: 'ref', filename: 'song.mp3', title: 'Song', sourceFormat: 'mp3' },
  lyrics: { kind: 'plain', lines: [{ text: 'cached lyric' }] },
  artworkBlob: new Blob(['cover'], { type: 'image/jpeg' }),
  mimeType: 'audio/mpeg', playbackCapability: 'supported', metadataStatus: 'parsed',
  sourceLifecycle: 'external-reference', source: { kind: 'web-file-handle', handle },
});

describe('LocalMediaSourceResolver', () => {
  it('resolves a fresh File from a granted persistent web handle', async () => {
    const file = new File(['original audio'], 'song.mp3', { type: 'audio/mpeg' });
    const getFile = vi.fn(async () => file);
    const result = await resolveLocalMediaRecord(referenceRecord({ kind: 'file', name: file.name, queryPermission: async () => 'granted', getFile }));
    expect(result).toBe(file);
    expect(getFile).toHaveBeenCalledOnce();
  });

  it('requests read-only permission when playback follows a user action', async () => {
    const requestPermission = vi.fn(async () => 'granted' as const);
    const file = new File(['audio'], 'song.mp3');
    await expect(resolveLocalMediaSource({ kind: 'web-file-handle', handle: {
      kind: 'file', name: file.name, queryPermission: async () => 'prompt', requestPermission, getFile: async () => file,
    } }, { requestPermission: true })).resolves.toBe(file);
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it.each(['denied', 'prompt'] as const)('reports explicit recovery when permission is %s', async permission => {
    const promise = resolveLocalMediaSource({ kind: 'web-file-handle', handle: {
      kind: 'file', name: 'song.mp3', queryPermission: async () => permission, getFile: async () => new File([], 'song.mp3'),
    } });
    await expect(promise).rejects.toMatchObject({ code: 'permission-required' } satisfies Partial<LocalMediaSourceAccessError>);
    await expect(promise).rejects.toThrow('原文件不可访问，需要重新授权/重新定位');
  });

  it('can retry a previously denied handle from an explicit user recovery action', async () => {
    const file = new File(['audio'], 'song.mp3');
    const requestPermission = vi.fn(async () => 'granted' as const);
    await expect(resolveLocalMediaSource({ kind: 'web-file-handle', handle: {
      kind: 'file', name: file.name, queryPermission: async () => 'denied', requestPermission, getFile: async () => file,
    } }, { requestPermission: true })).resolves.toBe(file);
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it('reports moved or deleted source files without calling them corrupt', async () => {
    await expect(resolveLocalMediaRecord(referenceRecord({
      kind: 'file', name: 'missing.mp3', queryPermission: async () => 'granted', getFile: async () => { throw new DOMException('gone', 'NotFoundError'); },
    }))).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps legacy app-owned blob records playable', async () => {
    const legacy: LegacyBlobLocalMediaRecord = {
      schemaVersion: 1, id: 'legacy', fingerprint: 'legacy', importedAt: 1,
      metadata: { id: 'legacy', filename: 'legacy.mp3', title: 'Legacy', sourceFormat: 'mp3' },
      lyrics: { kind: 'none', lines: [] }, audioBlob: new Blob(['legacy']), mimeType: 'audio/mpeg',
      playbackCapability: 'supported', metadataStatus: 'parsed', sourceLifecycle: 'app-owned-blob-copy',
    };
    expect(await (await resolveLocalMediaRecord(legacy)).text()).toBe('legacy');
  });

  it('detects File System Access capability without guessing persistence', () => {
    expect(supportsPersistentWebFileHandles({ showOpenFilePicker() {} })).toBe(true);
    expect(supportsPersistentWebFileHandles({})).toBe(false);
  });

  it('resolves a nested track through one granted directory root', async () => {
    const file = new File(['audio'], 'song.mp3');
    const album = { kind: 'directory', name: 'Album', getFileHandle: async () => ({ kind: 'file', name: file.name, getFile: async () => file }) } as WebFileSystemDirectoryHandle;
    const requestPermission = vi.fn(async () => 'granted' as const);
    const rootHandle = {
      kind: 'directory', name: 'Music', queryPermission: async () => 'prompt', requestPermission,
      getDirectoryHandle: async () => album,
    } as WebFileSystemDirectoryHandle;
    const root: LocalMediaSourceRoot = { id: 'root-1', kind: 'web-directory-handle', name: 'Music', importedAt: 1, handle: rootHandle };
    await expect(resolveLocalMediaSource(
      { kind: 'web-directory-relative', rootId: root.id, relativePath: ['Album', 'song.mp3'] },
      { requestPermission: true, getDirectoryRoot: async () => root },
    )).resolves.toBe(file);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it('reports one-root reauthorization instead of requesting an individual file handle', async () => {
    const root: LocalMediaSourceRoot = {
      id: 'root-1', kind: 'web-directory-handle', name: 'Music', importedAt: 1,
      handle: { kind: 'directory', name: 'Music', queryPermission: async () => 'prompt' } as WebFileSystemDirectoryHandle,
    };
    await expect(resolveLocalMediaSource(
      { kind: 'web-directory-relative', rootId: root.id, relativePath: ['song.mp3'] },
      { getDirectoryRoot: async () => root },
    )).rejects.toMatchObject({ code: 'permission-required' });
  });

  it('detects directory picker capability independently from single-file support', () => {
    expect(supportsPersistentWebDirectoryHandles({ showDirectoryPicker() {} })).toBe(true);
    expect(supportsPersistentWebDirectoryHandles({ showOpenFilePicker() {} })).toBe(false);
  });
});
