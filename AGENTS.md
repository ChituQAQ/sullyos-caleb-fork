# SullyOS Xiafork Development Guardrails

This repository is a long-term fork of upstream SullyOS for personal companion runtime extensions.

The goal is to extend SullyOS while preserving long-term upstream mergeability and official backup compatibility.

## 1. Upstream First

* Treat `upstream` as the official SullyOS source of truth.
* Minimize invasive changes to upstream core code.
* Prefer Provider, Adapter, Extension, sidecar, and independent-store patterns.
* Do not perform broad rewrites when a narrow extension point is sufficient.
* Keep fork changes easy to review, revert, and rebase/merge against future upstream versions.

## 2. Git Is the Handoff Point

* The repository belongs to Git, not to any individual coding agent.
* Codex and Pi must not edit the same uncommitted working tree concurrently.
* A clean Git commit is the preferred handoff point between agents.
* Implement one small, testable concern at a time.
* Use focused branches and focused commits.
* Do not mix unrelated refactors with feature work.
* Never push, merge, rebase, reset, or rewrite history unless the current task explicitly authorizes it.

## 3. P0: Official Backup Bidirectional Compatibility

Official whole-machine backup compatibility is a P0 architecture constraint.

The fork must preserve both directions whenever technically possible:

1. An official SullyOS backup should be importable into Xiafork.
2. Xiafork should be able to produce an official-compatible backup that can be imported back into official SullyOS.

Therefore:

* Do not rename official IndexedDB stores.
* Do not remove official persisted fields.
* Do not silently change the meaning or type of official fields.
* Do not introduce irreversible migrations into official stores.
* Do not make fork-only data mandatory for official data to remain understandable.
* Preserve unknown official fields whenever practical.

Fork-only persisted data should prefer isolated namespaces such as:

* IndexedDB/store/key prefix: `xiafork_*`
* Backup sidecar path: `extensions/xiafork/`

Before extending official backup ZIP contents, verify whether the official importer safely ignores unknown sidecar files.

If official importer compatibility cannot be guaranteed, provide separate export modes:

* Official-Compatible
* Xiafork Extended

Long term, maintain golden backup fixtures for import/export compatibility tests.

The audited official baseline currently opens `AetherOS_Data` at database version 70. Any change to that database version or schema requires P0 compatibility review.

Every new IndexedDB store, `localStorage` key, or persisted field must declare its backup policy. For a new store, review and update together, as applicable:

* the export store list
* the store-to-backup field mapping
* `FullBackupData` and related types
* `DB.importFullData`
* V2 manifest and shard handling
* golden backup fixtures

Do not add destructive migrations for Xiafork convenience. Official backup restore is currently not a globally atomic transaction, so changes must not widen its destructive restore surface without an explicit compatibility and rollback design.

Until dynamic compatibility tests pass, `extensions/xiafork/` may be used only by Xiafork Extended backups. Official-Compatible backups must not depend on that sidecar. Do not assume the official importer will round-trip unknown sidecar entries or unknown top-level backup fields.

## 4. TTS Architecture Guardrail

No local TTS engine has been selected yet.

Current candidates include:

* GPT-SoVITS
* IndexTTS2
* future candidates

Do not bind SullyOS core code directly to GPT-SoVITS or IndexTTS2 before A/B selection is complete.

The intended abstraction direction is:

LocalTTSProvider
-> GPTSoVITSAdapter
-> IndexTTS2Adapter
-> FutureAdapter

Existing official providers such as Fish Audio and MiniMax must remain available unless a later task explicitly changes that requirement.

The audited official `TtsProvider` is currently a closed MiniMax/Fish Audio provider set. Xiafork local TTS must enter SullyOS through a unified provider/router abstraction; do not add new provider-specific UI or application branches.

`CallApp` currently contains a historical provider branch that bypasses `ttsRouter`. When a local provider is eventually added, adapt or consolidate `CallApp` into the same routing contract rather than adding another direct branch.

Until the M1 winner is decided, do not hard-code GPT-SoVITS or IndexTTS2 names into SullyOS business logic. The SullyOS-facing contract should be a `LocalTTSProvider` / adapter boundary.

TTS selection should be based on measured A/B results, including:

* voice similarity
* emotional expression and prosody
* short-text quality
* long-text quality
* first-packet latency
* total generation speed
* VRAM usage
* RAM usage
* stability
* deployment/API complexity
* training or voice-cloning requirements
* suitability for everyday companion conversation

Do not implement a winner before the comparison is complete.

## 5. Work Memory Isolation

Future Work Mode memory isolation must be enforced at the code/data-flow level, not only by prompting.

Use an explicit scope concept such as:

`memoryScope = "work"`

Work-context details must not accidentally enter relationship-oriented or personal long-term memory systems, including:

* Memory Palace
* relationship impressions
* daily emotional summaries
* long-term shared memories
* companion relationship progression

Prompt-only separation is not sufficient.

`memoryScope` must be a typed data-flow property carried through message creation, request construction, asynchronous execution, and response post-processing. It must not be inferred only from a system prompt or textual instruction.

A work scope must prevent personal-memory recall and writes, including these side effects:

* Memory Palace writes
* traditional auto archive
* `CharacterProfile.memories`
* relationship impression or progression
* emotion and buff state
* ambient events
* cognitive digestion

The scope contract must cover Chat, Instant Push, Call, Date, VR, and future conversation entrypoints.

## 6. Local Music Direction

Local music should be developed incrementally.

Phase A:

* local MP3/FLAC playback inside SullyOS
* metadata extraction
* current-track state
* reuse existing together-listening experience where practical

Phase B:

* Windows Now Playing / SMTC bridge

Do not build Phase B before the local-file MVP proves the integration path.

Do not rewrite `MusicProvider` or the existing player for the local-file MVP. Local MP3/FLAC support should first reuse the existing `Song`, `localAssetKey`, `localMimeType`, `assets` store, `addLocalSong`, and `playSong` seams.

Local music catalog metadata and its audio Blob must be validated as one backup consistency unit. A backup must not preserve only the audio Blob while losing the catalog metadata needed to find and play it.

## 7. Cross-Device Direction

Prefer existing official synchronization/export infrastructure before introducing new central infrastructure.

First reuse official mechanisms such as:

* WebDAV backup
* GitHub backup
* explicit handoff/export

Do not introduce a central database or realtime synchronization server until there is a demonstrated requirement that existing mechanisms cannot satisfy.

## 8. Desktop Layout Direction

Do not perform a broad desktop UI rewrite.

Future desktop-specific work should initially focus only on high-frequency pages such as:

* Message
* Work

Other applications should remain compatible with the existing phone-frame interaction model unless a later milestone explicitly changes this.

M8 must not rewrite `PhoneShell`. Desktop layout should live locally in the Message/Chat root and the future Work root wherever practical. Other applications should continue using the existing shell and layout by default.

## 9. Persistence Changes Require Extra Review

Any task touching the following areas requires explicit compatibility review before implementation:

* IndexedDB schema
* backup import/export
* migrations
* memory persistence
* character persistence
* settings persistence
* sync state

For such changes, first identify:

1. official persisted structures affected
2. backward compatibility impact
3. forward compatibility impact
4. backup round-trip impact
5. rollback path
6. whether fork-only state can be isolated instead

## 10. Validation Discipline

Before changing code:

* inspect the relevant official implementation
* identify the narrowest extension point
* record compatibility assumptions

After changing code:

* run the smallest relevant tests first
* inspect `git diff`
* verify unrelated files did not change
* verify generated files did not create accidental tracked diffs
* keep the working tree clean before handing work to another agent

Existing upstream baseline test failures must not be silently attributed to Xiafork.

New failures introduced after fork changes must be distinguished from known upstream baseline failures.

## 11. Current Development Order

Unless a later explicit project decision changes the order, prioritize:

* M0: official development baseline
* M1: local TTS A/B evaluation
* M2: unified local TTS provider abstraction
* M3: official backup bidirectional compatibility
* M4: local music together-listening MVP
* M5: Work Mode Lite with memory isolation
* M6: bridge project summary
* M7: automatic cross-device handoff
* M8: desktop layout for selected high-frequency pages
* M9: central server / realtime sync only if later proven necessary

Do not start multiple major milestones simultaneously.

## 12. Explicit Non-Goals for Early Development

Do not prematurely:

* rewrite Memory Palace
* introduce a central database
* introduce realtime synchronization
* redesign the entire UI
* implement multiple TTS engines directly inside SullyOS core
* combine TTS, backup, music, and Work Mode changes in one branch
* break official backup semantics for convenience

When uncertain, prefer the smaller and more reversible change.

## 13. Agentic Tool Integration

Any new built-in tool must be reviewed across all official execution paths:

* the frontend parser and tool loop
* the Instant Push classifier and pending-tool loop
* the AMSG worker

Tools with side effects must not rely only on prompt-level confirmation. Any new write-capable tool requires a code-level permission gate.

When an external project or tool can be integrated through MCP, prefer MCP over adding invasive logic to the core built-in tool dispatcher.
