import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { BACKUP_FORMAT_VERSION } from './backupFormat';
import { assertSupportedSullyBackup } from './backupImportPolicy';
import {
    buildSyntheticBackupFixture,
    XIAFORK_FIXTURE_SIDECAR_PATH,
} from './__fixtures__/backupCompatibility';

const OFFICIAL_PAYLOAD_ENTRIES = [
    'manifest.json',
    'metadata.json',
    'stores/characters.000.json',
    'stores/memoryNodes.000.json',
    'stores/memory_vectors.bin',
    'stores/memory_vectors.index.json',
    'stores/messages.000.json',
];

describe('M3 backup compatibility synthetic scaffolding', () => {
    it('builds a small Official-Compatible V2 archive without a Xiafork sidecar', async () => {
        const fixture = await buildSyntheticBackupFixture('official-compatible');

        expect(fixture.manifest).toMatchObject({
            formatVersion: BACKUP_FORMAT_VERSION,
            mode: 'full',
            assetCount: 0,
            vectors: { count: 1, byteLength: 16 },
        });
        expect(fixture.entries).toEqual(OFFICIAL_PAYLOAD_ENTRIES);
        expect(fixture.entries.some(name => name.startsWith('extensions/xiafork/'))).toBe(false);
        expect(fixture.archive.byteLength).toBeLessThan(20_000);
        expect(() => assertSupportedSullyBackup(fixture.assembled)).not.toThrow();

        expect(fixture.assembled.characters).toEqual([{
            id: 'char_fixture_01',
            name: 'Synthetic Character',
            avatar: '',
        }]);
        expect(fixture.assembled.messages).toHaveLength(1);
        expect(fixture.assembled.memoryVectors).toHaveLength(1);
        const vector = fixture.assembled.memoryVectors[0].vector as Uint8Array;
        expect(Array.from(new Float32Array(vector.buffer, vector.byteOffset, 4))).toEqual([0.125, 0.25, 0.5, 1]);
    });

    it('keeps the Extended sidecar in the ZIP while official V2 assembly ignores it', async () => {
        const fixture = await buildSyntheticBackupFixture('xiafork-extended');
        const zip = await JSZip.loadAsync(fixture.archive);

        expect(fixture.entries).toEqual([...OFFICIAL_PAYLOAD_ENTRIES, XIAFORK_FIXTURE_SIDECAR_PATH].sort());
        expect(zip.file(XIAFORK_FIXTURE_SIDECAR_PATH)).not.toBeNull();
        expect(fixture.assembled).not.toHaveProperty('extensions');
        expect(fixture.assembled).not.toHaveProperty('xiafork');
        expect(fixture.assembled.characters).toHaveLength(1);
        expect(() => assertSupportedSullyBackup(fixture.assembled)).not.toThrow();
        expect(fixture.descriptor.intentionallyNotPromised).toContain(
            'official re-export preservation of extensions/xiafork/*',
        );
    });

    it('records record-level and top-level unknown fields as distinct expectations', async () => {
        const fixture = await buildSyntheticBackupFixture('unknown-fields');

        expect(fixture.assembled.characters[0].futureOfficialField).toEqual({ retained: true, revision: 1 });
        expect(fixture.assembled.unknownTopLevelFixtureField).toEqual({ retainedDuringAssembly: true });
        expect(fixture.descriptor.expectedPreservation.recordUnknownFields).toBe(true);
        expect(fixture.descriptor.expectedPreservation.topLevelUnknownFieldsOnAssembly).toBe(true);
        expect(fixture.descriptor.intentionallyNotPromised).toContain(
            'official re-export preservation of unknown top-level backup fields',
        );
        expect(() => assertSupportedSullyBackup(fixture.assembled)).not.toThrow();
    });

    it.each(['official-compatible', 'xiafork-extended', 'unknown-fields'] as const)(
        '%s fixture metadata and payload digest are deterministic',
        async profile => {
            const first = await buildSyntheticBackupFixture(profile);
            const second = await buildSyntheticBackupFixture(profile);

            // ZIP container timestamps may differ. Hash the sorted entry names and uncompressed payload bytes,
            // which is the compatibility-relevant deterministic fixture identity.
            expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(first.contentSha256).toBe(second.contentSha256);
            expect(first.descriptorSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(first.descriptorSha256).toBe(second.descriptorSha256);
            expect(first.descriptor).toEqual(second.descriptor);
        },
    );

    it('contains no credential-shaped fields or real-data placeholders', async () => {
        for (const profile of ['official-compatible', 'xiafork-extended', 'unknown-fields'] as const) {
            const fixture = await buildSyntheticBackupFixture(profile);
            const zip = await JSZip.loadAsync(fixture.archive);
            const textPayloads: string[] = [];
            for (const name of fixture.entries.filter(name => !name.endsWith('.bin'))) {
                textPayloads.push(await zip.file(name)!.async('string'));
            }
            const text = textPayloads.join('\n');
            expect(text).not.toMatch(/api[_-]?key|access[_-]?token|password|cloudBackupConfig/i);
            expect(text).not.toMatch(/-----BEGIN [A-Z ]+PRIVATE KEY-----/);
        }
    });
});
