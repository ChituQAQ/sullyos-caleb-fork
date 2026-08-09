import { beforeEach, describe, expect, it } from 'vitest';
import { getLocalTrack, listLocalTracks, putLocalTrack, removeLocalTrack } from './library';
import type { LocalMediaRecord } from './types';

const record = (id: string): LocalMediaRecord => ({
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
    expect(await stored?.audioBlob.text()).toBe('track-a');
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
});
