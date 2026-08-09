import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
    assembleV2Backup,
    writeV2Backup,
    type BackupManifest,
    type VectorIndexEntry,
} from '../backupFormat';

export type SyntheticBackupProfile = 'official-compatible' | 'xiafork-extended' | 'unknown-fields';

export interface SyntheticFixtureDescriptor {
    id: string;
    producer: 'xiafork-test-harness';
    profile: SyntheticBackupProfile;
    formatVersion: 2;
    mode: 'full';
    createdAt: number;
    syntheticOnly: true;
    expectedEntries: string[];
    expectedPreservation: {
        officialRecords: true;
        recordUnknownFields?: true;
        topLevelUnknownFieldsOnAssembly?: true;
        sidecarOnXiaforkExtended?: true;
    };
    intentionallyNotPromised: string[];
}

export interface SyntheticBackupFixture {
    archive: Uint8Array;
    assembled: Record<string, any>;
    contentSha256: string;
    descriptor: SyntheticFixtureDescriptor;
    descriptorSha256: string;
    entries: string[];
    manifest: BackupManifest;
}

const FIXED_CREATED_AT = Date.UTC(2026, 7, 9, 0, 0, 0);
const SIDECAR_PATH = 'extensions/xiafork/fixture.json';

const canonicalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
        return Object.fromEntries(
            Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
        );
    }
    return value;
};

const sha256 = (value: string | Uint8Array): string =>
    createHash('sha256').update(value).digest('hex');

const listPayloadEntries = (zip: JSZip): string[] =>
    Object.values(zip.files)
        .filter(entry => !entry.dir)
        .map(entry => entry.name)
        .sort();

const hashZipPayloads = async (zip: JSZip): Promise<string> => {
    const hash = createHash('sha256');
    for (const name of listPayloadEntries(zip)) {
        const bytes = await zip.file(name)!.async('uint8array');
        hash.update(name);
        hash.update(new Uint8Array([0]));
        hash.update(bytes);
        hash.update(new Uint8Array([0xff]));
    }
    return hash.digest('hex');
};

const makeVectorPayload = () => {
    const values = new Float32Array([0.125, 0.25, 0.5, 1]);
    const bin = new Uint8Array(values.buffer.slice(0));
    const index: VectorIndexEntry[] = [{
        memoryId: 'memory_fixture_01',
        charId: 'char_fixture_01',
        dimensions: values.length,
        model: 'synthetic-embedding-v1',
        byteOffset: 0,
        byteLength: bin.byteLength,
    }];
    return { bin, index };
};

const makeBackupData = (profile: SyntheticBackupProfile): Record<string, any> => {
    const character: Record<string, any> = {
        id: 'char_fixture_01',
        name: 'Synthetic Character',
        avatar: '',
    };
    const data: Record<string, any> = {
        timestamp: FIXED_CREATED_AT,
        version: 3,
        userProfile: { id: 'user_fixture_01', name: 'Synthetic User', avatar: '' },
        characters: [character],
        messages: [{
            id: 1,
            charId: 'char_fixture_01',
            role: 'user',
            type: 'text',
            content: 'Synthetic backup compatibility message.',
            timestamp: FIXED_CREATED_AT,
        }],
        memoryNodes: [{
            id: 'memory_fixture_01',
            charId: 'char_fixture_01',
            content: 'Synthetic memory.',
            room: 'living_room',
            importance: 1,
            tags: ['synthetic'],
            createdAt: FIXED_CREATED_AT,
        }],
    };
    if (profile === 'unknown-fields') {
        character.futureOfficialField = { retained: true, revision: 1 };
        data.unknownTopLevelFixtureField = { retainedDuringAssembly: true };
    }
    return data;
};

const makeDescriptor = (
    profile: SyntheticBackupProfile,
    expectedEntries: string[],
): SyntheticFixtureDescriptor => ({
    id: profile === 'official-compatible'
        ? 'F05-synthetic'
        : profile === 'xiafork-extended'
            ? 'F06-synthetic'
            : 'F07-synthetic',
    producer: 'xiafork-test-harness',
    profile,
    formatVersion: 2,
    mode: 'full',
    createdAt: FIXED_CREATED_AT,
    syntheticOnly: true,
    expectedEntries,
    expectedPreservation: {
        officialRecords: true,
        ...(profile === 'unknown-fields'
            ? { recordUnknownFields: true as const, topLevelUnknownFieldsOnAssembly: true as const }
            : {}),
        ...(profile === 'xiafork-extended' ? { sidecarOnXiaforkExtended: true as const } : {}),
    },
    intentionallyNotPromised: profile === 'xiafork-extended'
        ? ['official re-export preservation of extensions/xiafork/*']
        : profile === 'unknown-fields'
            ? ['official re-export preservation of unknown top-level backup fields']
            : ['fork-only state outside the official-compatible contract'],
});

export async function buildSyntheticBackupFixture(
    profile: SyntheticBackupProfile,
): Promise<SyntheticBackupFixture> {
    const zip = new JSZip();
    const vectors = makeVectorPayload();
    await writeV2Backup(zip as any, makeBackupData(profile), {
        mode: 'full',
        createdAt: FIXED_CREATED_AT,
        assetCount: 0,
        vectors,
    });

    if (profile === 'xiafork-extended') {
        zip.file(SIDECAR_PATH, JSON.stringify({
            formatVersion: 1,
            fixture: true,
            catalog: [{ id: 'song_fixture_01', assetKey: 'audio_fixture_01', mimeType: 'audio/flac' }],
        }));
    }

    const archive = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });
    const loaded = await JSZip.loadAsync(archive);
    const entries = listPayloadEntries(loaded);
    const manifest = JSON.parse(await loaded.file('manifest.json')!.async('string')) as BackupManifest;
    const assembled = await assembleV2Backup(loaded as any, manifest);
    const descriptor = makeDescriptor(profile, entries);

    return {
        archive,
        assembled,
        contentSha256: await hashZipPayloads(loaded),
        descriptor,
        descriptorSha256: sha256(JSON.stringify(canonicalize(descriptor))),
        entries,
        manifest,
    };
}

export const XIAFORK_FIXTURE_SIDECAR_PATH = SIDECAR_PATH;
