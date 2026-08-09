# Xiafork Backup Compatibility Test Plan

This plan defines the P0 compatibility evidence required before Xiafork changes SullyOS whole-machine backup behavior. It is based on the official baseline at `44bdf88dc35eb2f5edee9ce56b92716a3fca76df` and the audited Xiafork master lineage. Tests must use synthetic data only.

## Compatibility Goals

The compatibility suite must independently prove these contracts:

### A. Official SullyOS backup -> Xiafork import

Xiafork must accept supported official full, text-only, and media-only backups without changing the meaning or type of official fields. Unknown record-level fields should be preserved wherever the official import path writes the complete record.

### B. Xiafork Official-Compatible export -> Official SullyOS import

Official-Compatible output must use only the official archive contract and must not require fork-only stores, top-level fields, or sidecar files. An official importer must be able to restore all data promised by this mode.

### C. Xiafork Extended -> Xiafork

Extended output may contain isolated `extensions/xiafork/` data. Xiafork must validate and restore its extension payload without making that payload necessary to understand official data.

### D. Official backup plus unknown `extensions/xiafork/*` -> Official importer

The audited baseline importer appears to ignore ZIP entries that are neither declared by the V2 manifest nor referenced as assets. This must be confirmed dynamically with the official build. Success means the official data imports unchanged; it does not mean the official exporter preserves the unknown entry.

## Golden Fixture Matrix

All fixtures are synthetic, deliberately small, secret-free, and immutable after publication. Each committed/generated artifact must have deterministic metadata and a recorded SHA-256 digest.

| ID | Fixture | Producer | Format | Expected importer | Expected result | Preserved data | Intentionally lost / not promised | Destructive risk | Round-trip expectation |
|---|---|---|---|---|---|---|---|---|---|
| F01 | `official-full` | Unmodified official SullyOS baseline | Official V2 ZIP, `mode=full` | Xiafork | Success | All declared official stores, selected settings, assets, vectors | Runtime/session state excluded by official exporter | High: full restore clears and rewrites known stores | Official -> Xiafork must reproduce the declared fixture inventory |
| F02 | `official-text-only` | Unmodified official SullyOS baseline | Official V2 ZIP, `mode=text_only` | Xiafork | Success | Text stores, selected settings, vector binary, non-media metadata | Raw media and intentionally stripped image/blob references | Medium: text stores may be clear-and-written | Restored text inventory must match; media loss must match mode contract |
| F03 | `official-media-only` | Unmodified official SullyOS baseline | Official V2 ZIP, `mode=media_only` | Xiafork | Success | Official media/theme subset and media patches | Text-only stores and settings outside media mode | Medium: selected stores and assets are mutated | Only the documented media subset is compared |
| F04 | `official-plus-unknown-sidecar` | Test harness adds an unreferenced synthetic entry to F01 | Official V2 ZIP plus `extensions/xiafork/probe.json` | Official baseline and Xiafork | Expected success; official dynamic result remains a release gate | All official fixture data | Sidecar preservation by official re-export is not promised | High if tested against a non-isolated profile | Import official data, then confirm official re-export may omit the probe without corrupting official content |
| F05 | `xiafork-official-compatible` | Xiafork Official-Compatible exporter | Official-compatible V2 ZIP with no required fork extension | Official baseline and Xiafork | Success | Every official field promised by the selected mode | Fork-only state explicitly excluded from compatible mode | High: exercises official restore | Xiafork-compatible -> official must preserve the official inventory and produce no required sidecar dependency |
| F06 | `xiafork-extended` | Xiafork Extended exporter | Official V2-compatible body plus isolated `extensions/xiafork/` payload | Xiafork; official as a compatibility probe | Xiafork success; official success only if unknown-entry test passes | Official body and supported Xiafork extension data in Xiafork | Official re-export may discard extension entries | High: two importers and extension restore | Extended -> Xiafork preserves both layers; Extended -> official preserves only the official contract |
| F07 | `unknown-record-fields` | Synthetic fixture generator | V2 ZIP with extra fields inside known store records, an unknown top-level metadata field, and a declared expectation file | Xiafork and official baseline | Import should succeed unless a documented validator rejects it | Record-level extras where records are put intact | Unknown top-level fields are not promised on re-export | Medium: known stores are rewritten | Compare record-level, top-level, object-store, and ZIP-entry outcomes separately |
| F08 | `local-music-catalog-plus-assets` | Synthetic Xiafork fixture generator | Extended fixture with tiny catalog metadata and a tiny fake audio Blob marker | Xiafork only until product policy exists | Future success criterion; initially documents a known gap | Catalog entry, asset key/MIME link, referenced Blob bytes | Queue/current position only if later declared part of policy | High: orphaned catalog or Blob is data loss | Catalog and Blob must restore as one consistency unit; neither half may pass alone |
| F09 | `memory-vector-binary` | Synthetic official-compatible generator | V2 ZIP with one minimal Float32 vector, binary file, and index | Official baseline and Xiafork | Success | Vector identity, character link, dimensions, model, exact Float32 bytes | Nothing in the declared one-vector sample | High: importer clears `memory_vectors` before write | ZIP -> assembly -> IDB -> read-back must preserve count, metadata, and SHA-256 of vector bytes |
| F10 | `intentionally-interrupted-restore` | Fault-injection harness, generated at runtime only | Valid synthetic V2 ZIP with deterministic failure point | Disposable Xiafork test profile | Expected controlled failure | Pre-failure observations and import-progress evidence | Atomic rollback is not currently promised | Critical: intentionally creates partial restore | Must document which sections changed, prove no real profile was used, and leave the disposable database resettable |

## Test Directions

The suite must report each direction independently rather than treating a successful Xiafork self-round-trip as proof of official compatibility:

1. `official -> xiafork`
2. `xiafork-compatible -> official`
3. `xiafork-extended -> xiafork`
4. `xiafork-extended -> official`
5. `official -> xiafork -> official-compatible -> official`

Direction 5 is the bidirectional P0 gate. Its final comparison must use an official importer and compare semantic inventories, not ZIP byte equality, because archive ordering/compression may legitimately differ.

## Sidecar Semantics

The reserved fork path is `extensions/xiafork/`.

Static inspection of the current official baseline shows that import reads `manifest.json`, `metadata.json`, declared store shards, vector files, and referenced `assets/*`; it does not reject arbitrary additional ZIP entries. This makes an unreferenced sidecar likely import-safe for that revision, but dynamic compatibility evidence is still required.

The official importer/exporter does not promise passthrough preservation of unknown ZIP entries. Therefore:

* Official-Compatible backups must not contain or depend on Xiafork sidecars.
* Xiafork Extended is the only mode allowed to depend on `extensions/xiafork/`.
* A successful Extended -> official import proves only that official data survived; it does not prove sidecar round-trip.
* Sidecar validation and versioning must remain isolated from the official V2 manifest unless a later reviewed format decision says otherwise.

## IndexedDB Coverage

The primary official client database is `AetherOS_Data`, currently at version 70. Tests must inventory its official object stores and identify, per fixture, whether restore merges, patches, clears-and-writes, or leaves each store untouched.

`ActiveMsg` is a separate IndexedDB database. Its `kv`, `inbox`, `outbound_sessions`, `pending_tool_calls`, and `reasoning_buffer` stores are currently outside whole-machine backup. Tests must assert this exclusion so it cannot change accidentally. This plan does not decide that ActiveMsg should be backed up.

No destructive compatibility test may run against a developer's or user's normal browser profile. IndexedDB restore tests must use `fake-indexeddb`, a disposable browser profile, or an explicitly generated isolated database name/profile controlled by the harness.

## `localStorage` Coverage

Whole-machine backup uses an explicit field/key allowlist and helper exports, not a complete `localStorage` snapshot. Every new Xiafork key therefore needs an explicit policy: Official-Compatible, Extended-only, intentionally local/session-only, or prohibited.

The audit identified these music keys as a consistency risk:

* `sully_music_cfg_v1`
* `sully_music_state_v1`
* `sully_music_local_album_v1`

Audio data may exist in the `assets` store while catalog/queue metadata remains in those keys. F08 must detect a backup that preserves an audio Blob but loses the catalog entry required to locate it. The test plan records the gap; it does not change the current backup policy.

Test review must fail when a new Xiafork persistent key has no declared backup policy, even if the intended policy is “not backed up.” Transient `sessionStorage` is tracked separately and is not implicitly part of whole-machine backup.

## Restore Safety

Restore currently validates/parses the archive before database import, but the complete restore is not one global atomic transaction. `DB.importFullData` performs section-specific clear/merge/write operations, followed by settings and asset restoration.

Later destructive tests must cover:

* deterministic failure midway through store restore
* IndexedDB quota/write failure
* missing, invalid, or undecodable referenced asset
* malformed vector index
* vector count, byte-length, offset, and dimension mismatch
* manifest-declared missing shard and shard count mismatch

Every failure test must state the last possible mutation boundary and expected recovery instructions. Tests must never use real user data or a real user's `AetherOS_Data` database. Until rollback semantics are explicitly designed, a partial restore is an observed condition, not something a test should silently normalize away.

## WebDAV and GitHub Transport

WebDAV and GitHub are transports for the same ZIP payload produced by `exportSystem`; they must not define independent backup semantics.

Transport tests must eventually verify:

* upload input SHA-256 equals downloaded/reassembled ZIP SHA-256
* WebDAV ranged download produces byte-identical output
* GitHub single-asset download produces byte-identical output
* GitHub multipart assets are reassembled in exact order with no missing/duplicate bytes
* failed/incomplete multipart uploads are not offered as valid backups

M3 preparation tests must mock transport or operate entirely in memory. They must not upload a user backup or require real WebDAV/GitHub credentials.

## Unknown Data Categories

The suite must keep these compatibility categories separate:

| Category | Current static expectation | Required assertion |
|---|---|---|
| Unknown fields inside known records | Usually preserved when the full record is written with IndexedDB `put` | Compare the extra field after import and after supported round-trip paths |
| Unknown top-level backup fields | Import policy is permissive for most unknown names, but official export does not replay them | Import may succeed; re-export loss must be explicit and must not corrupt known data |
| Unknown IndexedDB object stores | Not cleared by known-store restore, but not exported by the official store list | Prove “left untouched locally” separately from “not included in backup” |
| Unknown ZIP entries | Current baseline parser appears to ignore unreferenced entries | Dynamic official import test; never claim official re-export preservation |

Passing one category must never be cited as evidence for another.

## Fixture Integrity and Hygiene

* Use fictional IDs such as `char_fixture_01` and non-personal text.
* Never include API keys, tokens, passwords, cloud credentials, real characters, real profiles, or real chat logs.
* Keep binary samples minimal: one-pixel synthetic images, marker bytes instead of playable audio, and one short Float32 vector.
* Store a fixture descriptor with producer baseline, mode, expected inventory, intentional losses, and SHA-256.
* If archives are generated during tests, normalize fixture metadata (`createdAt`, timestamps, entry order where controlled) before hashing.
* Golden fixtures are immutable. A format change creates a new fixture/version and requires explicit compatibility review.

## Execution Phases

1. Pure assembly tests: in-memory ZIP, manifest, shards, sidecar, vector validation.
2. Synthetic IndexedDB tests: `fake-indexeddb`, known-store restore, unknown record fields, interruption boundaries.
3. Disposable browser tests: official and Xiafork build import/export directions.
4. Mocked transport tests: WebDAV/GitHub byte equivalence.
5. Release gate: golden fixture matrix and direction report attached to the compatibility decision.

Production backup behavior must not be changed merely to satisfy an unverified fixture assumption. If a fixture reveals a real official behavior conflict or data-loss bug, stop and review the product/compatibility decision before implementing a fix.
