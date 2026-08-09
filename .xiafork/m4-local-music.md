# M4 Local Music + Together Listening MVP

## Status

The PC/web implementation is complete at the code and automated-test level. Android and iOS retain explicit adapter seams but were not runtime-tested from this Windows environment. Real-device acceptance with user-owned media remains the next human step.

M4 was explicitly authorized as an independent production milestone while M1 remains paused for human voice-quality/material optimization. This work does not select an M1 winner, change TTS, start M2-P1 or M3 production, or begin M5/M8.

## 1. Current architecture audit

- React 18 + Vite 5 application, with `MusicProvider` mounted globally above applications.
- `MusicContext` already owned one long-lived `HTMLAudioElement`, queue, progress, seek, previous/next, Media Session hooks, NetEase playback, generated local-song playback, and the module-level snapshot consumed by normal Chat and proactive prompt construction.
- `MusicApp` and `apps/music/MusicUI.tsx` already provided the SullyOS Shizuku visual language, player, synced lyric presentation, queue controls, and existing character-initiated together-listening badges.
- Generated songs used `Song.localAssetKey` and the official `AetherOS_Data.assets` store. Some official backup modes export `assets`; using it for arbitrary user media could silently add gigabytes to backup ZIPs.
- Official DB version remains 70. No official store, field meaning, import/export type, manifest, or migration was changed.
- Capacitor 6 exists, but no document-picker or native background-media plugin is installed. HTML file input is the current cross-platform picker seam.

## 2. Feature implementation

The implementation adds small modules under `utils/localMusic/`:

- `types.ts`: normalized track, lyrics, import, playback capability, and `NowPlayingState` contracts.
- `library.ts`: `LocalMediaLibrary` implementation in the isolated `xiafork_local_media` IndexedDB database.
- `metadata.ts`: `MetadataExtractor`, batch importer, stable fingerprinting, runtime decode capability checks, and `Song` adapter.
- `lyrics.ts`: `LyricsEngine` normalization, LRC parser, active-line lookup, and seek-target conversion.
- `playbackEngine.ts`: replaceable `PlaybackEngine` contract and current `HtmlAudioPlaybackEngine` adapter.
- `togetherListening.ts`: safe `NowPlayingState` construction and metadata-only context projection.

`MusicContext` remains the narrow integration point. It does not gain engine-specific application branches and can later swap the HTML adapter for native Media3/AVPlayer implementations.

## 3. Supported/imported formats

The picker accepts MP3, WAV, FLAC, M4A, AAC, OGG, and MP4-with-audio. Extension and parser checks tolerate inaccurate MIME values. `HTMLAudioElement.canPlayType` is evaluated per file; an unsupported result is shown before playback, while a runtime-dependent result remains explicit. A container that claims support but contains no decodable audio produces a visible playback error.

`music-metadata` 11.14.0 is the only new dependency. It is MIT licensed, actively published at audit time, browser/bundler compatible, and documents MP3/MP4/FLAC/Ogg/WAV/AAC plus ID3, Vorbis, iTunes/MP4, LRC, SYLT, and USLT support. It added 12 packages; the resulting lazy Music application chunk is about 26 KB gzip in the measured production build. No discontinued `music-metadata-browser` wrapper was used.

Automated tests use generated Blobs and parser fakes rather than copyrighted music. Therefore per-format real-fixture metadata and decoder claims remain `UNVERIFIED`/`RUNTIME_DEPENDENT` until human acceptance.

## 4. Metadata and artwork

Normalized metadata includes stable ID, original filename, title, artist, album, album artist, duration, track/disc number, source format, codec/container, and optional artwork. Empty title falls back to the filename without extension; Unicode and Chinese text are preserved. Front cover is preferred, then the first embedded picture. Parser failure is isolated per file and produces a visible filename-metadata fallback if the runtime reports the file playable.

Artwork remains a Blob in the same local-media record. UI hooks create object URLs only while mounted and revoke them when the value changes or the component unmounts. The audio engine revokes the previous audio object URL on track switch and on disposal. Missing artwork uses the existing soft purple/pink SullyOS visual palette.

## 5. Lyrics sources and precedence

Precedence is:

1. embedded synchronized lyrics emitted by the actual parser (millisecond SYLT or embedded LRC-like data);
2. a same-batch, basename-matched external `.lrc` file;
3. embedded plain lyrics;
4. no lyrics.

The local LRC adapter supports `[mm:ss.xx]`, `[mm:ss.xxx]`, colon fractions, signed `[offset:...]`, multiple timestamps on one line, common metadata lines, blank lines, and malformed-line isolation. Enhanced word timing is not falsely interpreted; unsupported word-level detail is ignored while valid line timing is retained where present. Plain lyrics carry no synthetic timestamps.

## 6. Timed lyric UX

Synced lyrics highlight the current line, keep surrounding lines visible, center smoothly, update immediately after seek, and allow click/tap-to-seek. Pointer, wheel, or touch browsing suspends auto-follow for five seconds; “回到当前歌词” restores it immediately. Plain lyrics remain fully scrollable and their rows are not seekable. Player progress does not cause the whole page to rerender on a 100 ms timer; updates follow native media `timeupdate` events.

## 7. Playback architecture

The current engine has explicit `idle`, `loading`, `playing`, `paused`, `ended`, and `error` states and supports load, play, pause, seek, previous, next, queue boundary behavior, duration/current time, and volume. A request gate rejects stale async results after rapid track switches. There remains exactly one audio instance. Existing NetEase and generated-song behavior remains available.

## 8. Storage and persistence compatibility review

Lifecycle strategy: **app-owned Blob copy** on current web/PC and Capacitor WebView paths. The source file is only read; it is never changed, moved, deleted, tagged, or written back. Removing a song deletes only the app-owned record.

Persistence review:

1. Official structures affected: none. `AetherOS_Data` and DB version 70 are unchanged.
2. Backward compatibility: official SullyOS data and backups read unchanged; absence of the Xiafork database means an empty local library.
3. Forward compatibility: official code ignores the separate database; queue records contain optional unknown `Song` fields and preserve existing fields.
4. Backup round trip: local catalog metadata, artwork, lyrics, and audio Blob live as one record, so in-database consistency is atomic. The entire database is intentionally excluded from Official-Compatible backup and current Xiafork backups. No backup can contain a discoverable catalog while silently omitting only its media, or vice versa.
5. Rollback: remove the fork build or delete individual app-owned library entries; official DB data is untouched. No destructive migration exists.
6. Isolation: database `xiafork_local_media`, store/indexes `xiafork_*`; no new official store or localStorage key.

Large files use IndexedDB Blob structured cloning rather than base64 or the small/generated-asset cache. Quota failures fail that item and do not abort the rest of the batch. There is no automatic eviction in M4.

## 9. Now Playing and Together Listening

`NowPlayingState` contains `trackId`, title, artist, optional album, duration/position in milliseconds, playing state, and `source: local`. Position advances only in local state; it never schedules LLM requests.

Imported local tracks are private by default. The player exposes an explicit “和夏以昼一起听” toggle. Disabled means prompt construction emits no local now-playing context. Enabled means normal Chat, emotion evaluation, and the existing centralized proactive payload builder read one snapshot only when constructing a generation request. The projection contains title, artist, optional album, and playing/paused state.

The projection cannot contain the audio Blob/bytes, artwork, lyrics, official/local storage keys, absolute paths, file URIs, content URIs, object URLs, or source references. Playback or pause never triggers an AI reply by itself. No audio recognition, microphone identification, fingerprint service, online lyrics, cover lookup, or music upload exists.

## 10. Platform strategy

### PC/Web current implementation

- Multi-file browser picker, app-owned IndexedDB Blob copy, `music-metadata` browser parsing, and HTML audio playback.
- Reload/restart persistence works while the origin's IndexedDB remains available.
- Browser codec support is authoritative and varies by browser/OS.

### Android architecture ready

- Current Capacitor WebView can use the HTML picker/copy fallback without retaining an unsafe source URI.
- A future native source resolver may adopt the Storage Access Framework and persistable content-URI permissions or copy into app storage.
- A future `Media3PlaybackEngine` / `MediaSessionService` adapter can replace the HTML engine for durable background playback and lock-screen/headset controls.
- Android runtime import/playback was not tested in this Windows run.

### iOS architecture ready

- Current WebView picker/copy fallback avoids depending on a security-scoped source URL after selection.
- A future document-picker adapter should copy into the app sandbox or manage security-scoped access explicitly.
- A future `AVPlayerPlaybackEngine` plus system Now Playing adapter can replace the HTML engine for durable background behavior.
- iOS build/sign/runtime testing was not available on Windows.

## 11. Tests and production gates

- M4/local context focused: 35/35 passed, including embedded lyrics, enhanced-LRC degradation, and rename-dedup coverage.
- Production worker build and Vite build: passed using `corepack pnpm@10 run build:workers` plus `npx vite build`; the repository's nested bare `pnpm` script is unavailable on this machine's PATH.
- Full suite: 2533/2547 passed (199/203 files). The remaining 14 failures are existing unrelated AMSG2 state tests, two CRLF-sensitive source-anchor tests, and an old lockfile-link test parser. No M4 failure appeared in the full run.
- Repository-wide TypeScript retains pre-existing unrelated errors in MemoryPalace, ThemeMaker, MessageItem, API logging, old `.mjs` test declarations, and Vite proxy configuration. A changed-source filtered check reports no M4 errors; production build passes.

## 12. Known limitations and follow-up enhancements

- Real user-owned MP3/FLAC/M4A/AAC/OGG/MP4 fixtures and browser decoder combinations require human acceptance; no format is claimed universally decodable.
- No directory-wide persistent permission, folder watcher, playlist editor, equalizer, or online enrichment.
- M4 does not include local media in any backup. A future Xiafork Extended media export needs explicit size UI, consistency validation, streaming, rollback, and golden fixtures.
- Browser storage quota is platform-specific; M4 reports failures but does not implement quotas or eviction.
- Native background playback, lock-screen controls, Media3/MediaSessionService, AVPlayer/System Now Playing, CarPlay, Android Auto, and SMTC are future enhancements.
- The together-listening toggle is session-scoped and intentionally does not create a persisted privacy setting.
