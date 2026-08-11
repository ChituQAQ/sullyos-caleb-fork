import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalTrack, getLocalTrackBlob, listLocalTracks, putLocalTrack, removeLocalTrack, replaceLocalTrackLyrics, replaceLocalTrackWebHandle } from './library';
import type { LegacyBlobLocalMediaRecord, LocalMediaRecord } from './types';

const record = (id: string): LegacyBlobLocalMediaRecord => ({
  schemaVersion: 1,
  id,
  fingerprint: id,
  importedAt: 100,
  metadata: { id, filename: `${id}.mp3`, title: id, sourceFormat: 'mp3' },
  lyrics: { kind: 'none', lines: [] },
  audioBlob: new Blob([id], { type: 'audio/mpeg' }),
  mimeType: 'audio/mpeg',
  playbackCapability: 'supported',
  metadataStatus: 'parsed',
  sourceLifecycle: 'app-owned-blob-copy',
});
describe('isolated local media library', () => {
  beforeEach(async () => {
    for (const item of await listLocalTracks()) await removeLocalTrack(item.id);
  });

  it('persists catalog metadata and Blob as one record', async () => {
    await expect(putLocalTrack(record('track-a'))).resolves.toBe('stored');
    const stored = await getLocalTrack('track-a');
    expect(stored?.metadata.title).toBe('track-a');
    expect(stored?.schemaVersion).toBe(1);
    expect(await getLocalTrackBlob('track-a').then(blob => blob?.text())).toBe('track-a');
  });

  it('deduplicates by stable fingerprint', async () => {
    await putLocalTrack(record('same'));
    await expect(putLocalTrack({ ...record('different-id'), fingerprint: 'same' })).resolves.toBe('duplicate');
    expect(await listLocalTracks()).toHaveLength(1);
  });

  it('removes only the app-owned record', async () => {
    const source = new File(['original'], 'source.mp3', { type: 'audio/mpeg' });
    await putLocalTrack(record('remove-me'));
    await removeLocalTrack('remove-me');
    expect(await getLocalTrack('remove-me')).toBeNull();
    expect(await source.text()).toBe('original');
  });

  it('refreshes only lyrics for an explicitly re-imported record', async () => {
    const original = record('lyrics-refresh');
    await putLocalTrack(original);
    await replaceLocalTrackLyrics(original.id, {
      kind: 'synced', source: 'embedded-synced', lines: [{ timeMs: 1000, text: 'original', translationText: '译文' }],
    });
    const refreshed = await getLocalTrack(original.id);
    expect(refreshed?.lyrics.lines[0]).toMatchObject({ text: 'original', translationText: '译文' });
    expect(await (refreshed && 'audioBlob' in refreshed ? refreshed.audioBlob.text() : Promise.resolve(undefined)))
      .toBe(await original.audioBlob.text());
    expect(refreshed?.metadata).toEqual(original.metadata);
  });

  it('updates only the opaque handle of a reference record', async () => {
    const reference: LocalMediaRecord = {
      schemaVersion: 2, id: 'reference', fingerprint: 'reference', importedAt: 1,
      metadata: { id: 'reference', filename: 'reference.mp3', title: 'Reference', sourceFormat: 'mp3' },
      artworkBlob: new Blob(['cover']), lyrics: { kind: 'plain', lines: [{ text: 'cached' }] },
      mimeType: 'audio/mpeg', playbackCapability: 'supported', metadataStatus: 'parsed',
      sourceLifecycle: 'external-reference', source: { kind: 'web-file-handle', handle: { kind: 'file', name: 'old.mp3' } as any },
    };
    await putLocalTrack(reference);
    await replaceLocalTrackWebHandle(reference.id, { kind: 'file', name: 'new.mp3' } as any);
    const updated = await getLocalTrack(reference.id);
    expect(updated?.schemaVersion === 2 && updated.source.kind === 'web-file-handle' && updated.source.handle.name).toBe('new.mp3');
    expect(updated?.metadata).toEqual(reference.metadata);
    expect(updated?.lyrics).toEqual(reference.lyrics);
    expect(updated?.artworkBlob).toBeInstanceOf(Blob);
  });
});
