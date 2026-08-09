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
