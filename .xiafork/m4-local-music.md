# M4 Local Music + Together Listening MVP

## Status

M4 Local Music Together-Listening MVP is **HUMAN ACCEPTED / COMPLETE**. Browser acceptance passed the unauthenticated entry, local playback, artwork surfaces, unobstructed Now Playing cover, one-row lyrics, full-document browsing, future seek, bilingual primary/translation display, pre-join awareness, official `MUSIC_ACTION` join, joined Together Listening, recursive directory import, Chromium restart recovery, one-root reauthorization, reference-only new imports, legacy Blob compatibility, cross-surface play/pause state, and AI-context privacy boundary.

`LRC_SIDECAR_REAL_ACCEPTANCE=NOT_TESTED`; automated coverage exists, but this is not claimed as a human pass.

M4 was explicitly authorized as an independent production milestone while M1 remains paused for human voice-quality/material optimization. This work does not select an M1 winner, change TTS, start M2-P1 or M3 production, or begin M5/M8.

## 1. Current architecture audit

- React 18 + Vite 5 application, with `MusicProvider` mounted globally above applications.
- `MusicContext` already owned one long-lived `HTMLAudioElement`, queue, progress, seek, previous/next, Media Session hooks, NetEase playback, generated local-song playback, and the module-level snapshot consumed by normal Chat and proactive prompt construction.
- `MusicApp` and `apps/music/MusicUI.tsx` already provided the SullyOS Shizuku visual language, player, synced lyric presentation, queue controls, and existing character-initiated together-listening badges.
- Generated songs used `Song.localAssetKey` and the official `AetherOS_Data.assets` store. Some official backup modes export `assets`; using it for arbitrary user media could silently add gigabytes to backup ZIPs.
- Official DB version remains 70. No official store, field meaning, import/export type, manifest, or migration was changed.
- Capacitor 6 exists, but no document-picker or native background-media plugin is installed. The current supported persistent import seam is Chromium's File System Access API; unsupported runtimes do not silently copy full audio bytes.

## 2. Feature implementation

The implementation adds small modules under `utils/localMusic/`:

- `types.ts`: normalized track, lyrics, import, playback capability, `NowPlayingState`, and opaque `LocalMediaSource` contracts.
- `library.ts`: `LocalMediaLibrary` implementation in the isolated `xiafork_local_media` IndexedDB database.
- `metadata.ts`: `MetadataExtractor`, batch importer, stable fingerprinting, runtime decode capability checks, and `Song` adapter.
- `lyrics.ts`: `LyricsEngine` normalization, LRC parser, active-line lookup, and seek-target conversion.
- `directoryImport.ts`: nested, sequential directory scan/import with same-folder sidecar matching, progress, and per-file failure isolation.
- `playbackEngine.ts`: replaceable `PlaybackEngine` contract and current `HtmlAudioPlaybackEngine` adapter.
- `sourceResolver.ts`: platform-neutral source resolution, read-only web-handle permission recovery, and future Android/iOS adapter boundary.
- `togetherListening.ts`: safe `NowPlayingState` construction and metadata-only context projection.

`MusicContext` remains the narrow integration point. It does not gain engine-specific application branches and can later swap the HTML adapter for native Media3/AVPlayer implementations.

## 3. Supported/imported formats

The picker accepts MP3, WAV, FLAC, M4A, AAC, OGG, and MP4-with-audio. Extension and parser checks tolerate inaccurate MIME values. `HTMLAudioElement.canPlayType` is evaluated per file; an unsupported result is shown before playback, while a runtime-dependent result remains explicit. A container that claims support but contains no decodable audio produces a visible playback error.

`music-metadata` 11.14.0 is the only new dependency. It is MIT licensed, actively published at audit time, browser/bundler compatible, and documents MP3/MP4/FLAC/Ogg/WAV/AAC plus ID3, Vorbis, iTunes/MP4, LRC, SYLT, and USLT support. It added 12 packages; the resulting lazy Music application chunk is about 26 KB gzip in the measured production build. No discontinued `music-metadata-browser` wrapper was used.

Automated tests use generated Blobs and parser fakes rather than copyrighted music. Therefore per-format real-fixture metadata and decoder claims remain `UNVERIFIED`/`RUNTIME_DEPENDENT` until human acceptance.

## 4. Metadata and artwork

Normalized metadata includes stable ID, original filename, title, artist, album, album artist, duration, track/disc number, source format, codec/container, and optional artwork. Empty title falls back to the filename without extension; Unicode and Chinese text are preserved. Front cover is preferred, then the first embedded picture. Parser failure is isolated per file and produces a visible filename-metadata fallback if the runtime reports the file playable.

Artwork remains a small Blob in the same local-media record. `useBlobRefUrl` is the shared render-resolution boundary for `http(s)`, `data:`, `blobref:`, and `xiafork-local-artwork:` values. Music rows, the in-app MiniPlayer, full player, Chat floating orb, Chat expanded player, desktop/home widget, and official `MUSIC_ACTION` chat cards all use that boundary; object URLs are revoked on value replacement/unmount. Missing artwork falls back safely. Local full-player artwork uses `VinylDisc.fullArtwork`, replacing the opaque center label with only a tiny spindle; default NetEase/generated rendering is unchanged.

## 5. Lyrics sources and precedence

Precedence is:

1. embedded synchronized lyrics emitted by the actual parser (millisecond SYLT or embedded LRC-like data);
2. a same-batch, basename-matched external `.lrc` file;
3. embedded plain lyrics;
4. no lyrics.

The local LRC adapter supports `[mm:ss.xx]`, `[mm:ss.xxx]`, colon fractions, signed `[offset:...]`, multiple timestamps on one line, common metadata lines, blank lines, and malformed-line isolation. Enhanced word timing is not falsely interpreted; unsupported word-level detail is ignored while valid line timing is retained where present. Plain lyrics carry no synthetic timestamps.

`LyricsDocument` explicitly models `text` as the primary/original row and optional `translationText` as secondary content; there is one active timeline and translation never receives an independent active index. The installed `music-metadata` 11.14.0 `ILyricsTag` exposes only `descriptor`, `language`, `text`, `contentType`, `timeStampFormat`, and `syncText[{text,timestamp?}]`. Embedded synchronized tracks are selected using explicit original/main and translation descriptors first, then file-level language identity, timestamp overlap/completeness, credit-line safety, and stable source order. A mixed frame's own language does not reorder its rows. No language is universally classified as translation. Separate synchronized tracks align by timestamp. Exact duplicate rows pair; near rows pair only with conservative script/language evidence, avoiding collapse of rapid same-language primary lines.

## 6. Timed lyric UX

Synced lyrics mount the complete normalized document, including future lines. The state is explicitly `following` or `browsing`: wheel, trackpad, touch start, or pointer down enters browsing before the native gesture proceeds, with no snap-back timer. The viewport is a definite-height, absolutely inset native `overflow-y-scroll` region with `touch-action: pan-y`; there is no input-intercepting mask or overlay. Browsing performs no auto-follow call. Any timed row can be clicked to seek and resume following; “回到当前歌词” resumes following without seeking. Plain lyrics remain fully scrollable and are not seekable.

## 7. Playback architecture

The current engine has explicit `idle`, `loading`, `playing`, `paused`, `ended`, and `error` states and supports load, play, pause, seek, previous, next, queue boundary behavior, duration/current time, and volume. `MusicContext.playing` is derived only from this engine state; the full player, MiniPlayer, Chat controls, and desktop widget consume that same value. Toggle and Media Session actions inspect `engine.currentState`, not `audio.paused` or a render closure. Play request generations suppress late Promise completions after pause/source replacement, and rejected play promises publish an error state. There remains exactly one audio instance. Existing NetEase and generated-song behavior remains available.

## 8. Storage and persistence compatibility review

Lifecycle strategy for new imports: **reference-only external media**. Chromium single-file import persists a structured-cloneable `FileSystemFileHandle`. The recommended large-library flow uses `showDirectoryPicker()`, stores one source-root handle, and stores only `rootId + relativePath` per track. Parsing reads a temporary `File`, stores normalized metadata, lyrics, fingerprint, embedded artwork cache, and the opaque reference, but never writes a complete audio Blob. Playback resolves a fresh `File`, creates an engine-owned temporary object URL, and revokes it on replacement/disposal. The source file is never changed, moved, deleted, tagged, or written. Removing a song deletes only the Xiafork catalog record. File and directory relink actions fingerprint-check an existing track before replacing authorization.

Persistence review:

1. Official structures affected: none. `AetherOS_Data` and DB version 70 are unchanged.
2. Backward compatibility: official SullyOS data and backups read unchanged; schema-v1 `app-owned-blob-copy` test records remain readable/playable and are not automatically deleted or duplicated (`LEGACY_BLOB_COMPAT=YES`). Absence of the Xiafork database means an empty local library.
3. Forward compatibility: official code ignores the separate database; queue records contain optional unknown `Song` fields and preserve existing fields.
4. Backup round trip: the fork-only database, including opaque handles, remains excluded from Official-Compatible and current Xiafork backup/export paths. Original media and source-reference internals are never exported. Small metadata/artwork/normalized-lyrics caches remain local.
5. Rollback: remove the fork build or delete individual library entries; original files and official DB data are untouched. No destructive migration exists.
6. Isolation: database `xiafork_local_media`, schema version 2, stores `xiafork_tracks` and `xiafork_source_roots`; no official database/store or localStorage key changed. Version 1 track records upgrade non-destructively and remain intact.

New imports therefore scale independently of audio-library byte size, aside from small cached metadata/artwork/lyrics. Stable duplicate detection still reads only bounded first/middle/last chunks. If a runtime cannot persist safe handles, the UI reports the capability limitation and does not pretend a copied or session-only file is a persistent import.

## 9. Now Playing and Together Listening

`NowPlayingState` contains `trackId`, title, artist, optional album, duration/position in milliseconds, playing state, and `source: local`. Position advances only in local state; it never schedules LLM requests.

The full player contains no fork-specific selector/status card. Official semantics have two distinct layers. `userListeningContext` tells the current conversation character what the user is playing before it joins; `listeningTogetherWith` tells whether that exact `CharacterProfile.id` has joined. This pre-join awareness is required for the model to decide to emit `[[MUSIC_ACTION:join]]`. `ChatParser` then calls the existing `musicHooks.joinListeningTogether(charId)`, which adds the character ID; only the next snapshot reports `isListeningTogether=true`. Another character may perceive the same sanitized user-listening fact but is not marked joined. The existing MiniPlayer displays/removes companions, and track changes/errors clear the relationship.

Local `getListeningSnapshot()` supplies the same safe Song fields as NetEase (`songId`, name, artists, album, internal artwork ref, duration, fee), so official `join`, `add`, and `join_and_add` actions do not fail for reference-backed media. The prompt projection itself contains only title, artist, optional album, and playing/paused state.

The projection cannot contain the audio Blob/bytes, artwork, lyrics, official/local storage keys, absolute paths, file URIs, content URIs, object URLs, or source references. Playback or pause never triggers an AI reply by itself. No audio recognition, microphone identification, fingerprint service, online lyrics, cover lookup, or music upload exists.

## 10. Platform strategy

### PC/Web current implementation

- Chromium multi-file `showOpenFilePicker` remains for ad-hoc tracks. Such handles may require individual authorization after a browser restart; the UI states that limitation.
- Chromium `showDirectoryPicker` is the recommended large-library path. It recursively scans nested directories sequentially, ignores unsupported files, matches same-folder basename `.lrc`, reports progress, isolates corrupt files, and stores one read-only root handle plus relative paths. One root grant unlocks all tracks beneath it when Chromium retains structured-clone and permission support.
- Reload/restart persistence depends on the origin retaining IndexedDB and browser permission. Revoked/moved/deleted sources show an explicit authorization/relink error; source roots expose one fingerprint-checked folder reauthorization action.
- Browser codec support is authoritative and varies by browser/OS.

### Android architecture ready

- `LocalMediaSourceResolver` reserves an Android content-URI adapter kind; client/library UI contains no platform branching.
- A future native adapter may adopt Storage Access Framework persistable read grants. No copy fallback or native plugin was added in this round.
- A future `Media3PlaybackEngine` / `MediaSessionService` adapter can replace the HTML engine for durable background playback and lock-screen/headset controls.
- Android runtime import/playback was not tested in this Windows run.

### iOS architecture ready

- `LocalMediaSourceResolver` reserves an iOS security-scoped adapter kind; client/library UI contains no platform branching.
- A future document-picker adapter must manage security-scoped access explicitly. No copy fallback or native plugin was added in this round.
- A future `AVPlayerPlaybackEngine` plus system Now Playing adapter can replace the HTML engine for durable background behavior.
- iOS build/sign/runtime testing was not available on Windows.

## 11. Tests and production gates

- M4/local context focused: 118/118 passed, including official action join, pre-join/joined distinction, native-scroll state seams, mixed-SYLT primary selection, descriptor/language selection, duplicate/near timestamp pairing, explicit duplicate-import lyric repair, directory references, root permission recovery, artwork lifecycle, and playback races. The repository has no jsdom/browser layout runner, so this is `LYRIC_SCROLL_LOGIC_TEST=PASS`, not real-browser proof.
- Production worker build and Vite build: passed using `corepack pnpm@10 run build:workers` plus `npx vite build`; the repository's nested bare `pnpm` script is unavailable on this machine's PATH.
- Full suite: 2588/2602 passed. The remaining 14 failures are the same existing unrelated AMSG2 state/source-anchor tests; the old lockfile-link parser also remains a failed suite before test collection. No M4 test failed.
- Repository-wide TypeScript retains pre-existing unrelated errors in MemoryPalace, ThemeMaker, MessageItem, API logging, old `.mjs` test declarations, and Vite proxy configuration. A changed-source filtered check reports no M4 errors; production build passes.

## 12. Known limitations and follow-up enhancements

- Real user-owned MP3/FLAC/M4A/AAC/OGG/MP4 fixtures and browser decoder combinations require human acceptance; no format is claimed universally decodable.
- No folder watcher, playlist editor, equalizer, or online enrichment. Chromium remains authoritative about whether a persisted directory permission survives restart; the application cannot bypass browser security.
- M4 does not include local media in any backup. A future Xiafork Extended media export needs explicit size UI, consistency validation, streaming, rollback, and golden fixtures.
- Persistent `FileSystemFileHandle` behavior still requires human acceptance in the target Chromium profile and origin.
- Native background playback, lock-screen controls, Media3/MediaSessionService, AVPlayer/System Now Playing, CarPlay, Android Auto, and SMTC are future enhancements.
- Together-listening membership is session-scoped in the official `listeningTogetherWith` state and does not create a fork privacy setting.

## 13. Acceptance navigation hotfix

User acceptance found that `MusicApp` initialized to the NetEase profile view. For a fresh user with no cookie, profile, or generated local-album songs, that view immediately returned `NeteaseLoginPanel`. The M4 local library was mounted in production under the `local` view, but its only normal entry was the folder action on the unreachable `search` view.

The focused hotfix makes the existing search/landing view the initial Music view and returns Profile back navigation to that landing view. A fresh user can therefore see and open Local Music without authentication, while the existing profile/login action keeps NetEase available as an optional online feature. Local, Profile, and Settings back navigation now converge on the landing view; the landing header remains the app-close boundary. No persistence, backup, playback, local-media, or TTS behavior changed.

Acceptance also found that lyric entries were inline-level buttons, allowing multiple entries to share a visual row. The player now renders a centered flex column whose entries are block-level, full-row buttons capped at a readable desktop width. Each entry can wrap internally; its translation remains inside the same button. Active styling continues to use `transform: scale(...)`, so it does not change text metrics or trigger layout reflow. Timed click-to-seek and manual-scroll/autofollow handlers are unchanged.

The former local Together Listening switch was a second global source of truth and has been removed from `MusicContext`, playback snapshots, and chat request construction. Round 2 also removed the replacement “和谁一起听” card from the full player. Round 3 corrected the circular dependency that remained: like official online music, the current conversation character receives sanitized pre-join awareness, then may independently choose the official `MUSIC_ACTION:join` path. Membership remains only in `listeningTogetherWith`; it controls joined wording and companion UI, not whether the character can perceive that the user is currently playing a song. Removing an ID makes only that character unjoined; switching tracks clears all joined IDs as before.

Round 2 removes the fork-added full-player volume slider while retaining `PlaybackEngine.setVolume` and the context capability for other/future callers. Removing the selector and volume chrome restores meaningful lyric height without shrinking type; the one-entry-per-row, readable max-width, wrap, timed seek, manual-scroll pause, and “回到当前歌词” behavior remain.

Round 2 replaces new audio-Blob imports with schema-v2 reference records. Metadata, normalized LRC/embedded lyrics, and cover art remain cached; complete audio bytes do not. Schema-v1 Blob records remain playable. Local source handles/URIs/bookmarks, filenames beyond catalog display metadata, audio, artwork bytes, and lyrics are excluded from AI context, analytics, backup, and export.

Round 3 adds focused coverage for official local `MUSIC_ACTION` join, awareness/join transition, character isolation, bilingual descriptor selection, duplicate timestamps, full browse/scrub wiring, directory recursion/LRC pairing/root authorization, and engine rapid-toggle/source-switch races. Final counts are recorded in `.xiafork/handoff.json` after the validation run.

## 14. Round 3 compatibility assumptions

- Official code audit confirmed that online `userListeningContext` is computed before and independently of `listeningTogetherWith`; `ChatParser` consumes `[[MUSIC_ACTION:join]]` and calls `joinListeningTogether(charId)`. Local music now follows that exact distinction without adding a manual selector.
- The fork-only IndexedDB version change from 1 to 2 only adds `xiafork_source_roots`. It does not touch official `AetherOS_Data` version 70, backup manifests, import/export, or restore transactions. Rollback leaves version-1 and version-2 catalog data isolated from official state; deleting a catalog entry never touches an original file.
- Directory handles and file handles are opaque authorization objects. They remain excluded from prompts, messages, logs, analytics, and all backup/export paths. Per-track relative paths are likewise excluded.
- Android `content://` and iOS security-scoped reference kinds remain architecture seams only. Round 3 adds no native plugin or platform UI branching.

## 15. Round 4 acceptance correction

Human runtime evidence overrides Round 3's synthetic claims. Final acceptance is `FULL_LYRIC_BROWSING=HUMAN_PASS`, `FUTURE_LYRIC_SEEK=HUMAN_PASS`, and `BILINGUAL_PRIMARY_LYRIC=HUMAN_PASS`. `LRC_SIDECAR_REAL_ACCEPTANCE=NOT_TESTED` remains intentionally unchanged.

The rendered scroll failure was not missing lyric rows. Round 3's `onScroll` synchronously queried every row, called `getBoundingClientRect()` for each, and set candidate state on every scroll event. That O(n) forced-layout/render loop made long real documents effectively non-scrollable, while the helper test had no rendered layout or event-frame cost. Round 4 removes the candidate scan and uses a constrained native scroll box with O(1) intent handling and a numeric programmatic target guard.

The NAIL failure was caused by using an individual bilingual SYLT frame's `language` as preferred primary language inside that same frame. Frame language is not file-level proof of the song's original language. Round 4 only permits file-level language or explicit descriptor evidence to reorder mixed rows; otherwise source order is stable. Development builds log a sanitized diagnostic containing track count, supported tag fields, sync/plain status, line/credit counts, three 48-character previews, selected indices, scores, and reasons—never paths, handles, URIs, full lyrics, or complete metadata.

Existing Round 3 records already contain their old normalized document. An explicit re-import of the same fingerprint now reparses and refreshes only a non-empty `LyricsDocument` while retaining duplicate status. Compatibility review: this touches only the existing `lyrics` field in the isolated `xiafork_tracks` record; it changes no database version/store, source handle, audio, artwork, catalog metadata, official backup/export, or restore path. The existing `text`/`translationText` shape remains backward-readable, and no automatic migration or destructive scan occurs.

## 16. M4.1 deferred lyrics UX polish

M4.1 is `FUTURE` and is not part of this release. Functional scrolling and seeking are accepted, but two interaction-quality items remain:

- make direct dragging/swiping anywhere in the lyric area feel like a mature native music application rather than effectively relying on the narrow right-side scrollbar;
- enlarge the lyric viewport by reconsidering the vertical proportions of top metadata, artwork, and bottom playback controls.

Do not reopen these items without a separate explicit M4.1 authorization.
