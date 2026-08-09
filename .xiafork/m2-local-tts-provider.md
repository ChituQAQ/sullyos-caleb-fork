# M2-P0 Local TTS service architecture preparation

Status: provider/service-neutral preparation only. M1 still requires a human-selected winner. M2 production integration and M8 remote-host implementation have not started.

> **M2-P0 DOES NOT expose TTS to the Internet.** It adds no endpoint, listener, model process, dependency, setting, credential, migration, or production execution path.

## 1. Scope and compatibility assumptions

This document is based on the repository at `1ee81ff2d36db4a37a3d0c21c560edbb908746e1` and read-only inspection of the locally available IndexTTS2 and GPT-SoVITS candidate trees. It does not select either candidate.

Compatibility assumptions:

- Official MiniMax and Fish Audio behavior remains available and remains the default-compatible path.
- Missing or unknown `apiConfig.ttsProvider` continues to normalize to `minimax`.
- Text chat completes independently of TTS; synthesis failure never removes or blocks the text reply.
- Existing `CharacterProfile.voiceProfile`, `APIConfig`, `os_api_config`, `assets`, `voice_msg_<messageId>`, and `tts_<hash>` data remains readable without migration.
- No IndexedDB version or store changes are needed for M2-P0. The official `AetherOS_Data` baseline remains version 70.
- A future fork-only endpoint/profile setting needs an explicit backup policy before implementation. Remote credentials must not be placed in an official-compatible backup.

## 2. Current official call-path audit

### Chat / Message

```text
AI text messages
  -> apps/Chat.tsx auto-TTS effect or MessageItem voice-bar click/long-press
  -> parse/translate/clean voice text in apps/Chat.tsx
  -> utils/ttsRouter.synthesizeSpeechDetailed
  -> resolve apiConfig.ttsProvider in utils/ttsProvider
  -> utils/minimaxTts.synthesizeSpeechDetailed
       or utils/fishAudioTts.synthesizeSpeechFishDetailed
  -> shared hash/cache in utils/ttsCache (IndexedDB assets store)
  -> object URL or provider remote URL
  -> apps/Chat.tsx HTMLAudioElement playback
  -> per-message StoredVoice in assets key voice_msg_<messageId>
  -> components/chat/MessageItem.tsx renders loading/voice/playback state
```

- Trigger and UI state: `apps/Chat.tsx` owns `voiceDataMap`, `voiceLoading`, `playingMsgId`, the audio element, automatic generation, manual generation, toast errors, and asset hydration. `components/chat/MessageItem.tsx` is presentation-only and calls `onPlayVoice`.
- Availability currently combines provider-specific character fields with credentials. The local helper is misleadingly named `isMinimaxReady`, although it also handles Fish Audio.
- Automatic generation only occurs for tagged assistant messages when `chatVoiceEnabled` and `chatVoiceAutoPlay` allow it. A user-triggered synthesis plays immediately.
- Failure is caught and surfaced as `语音生成失败`; the text message remains intact.

### Date

```text
Date dialogue line / manual line play
  -> components/date/DateSession.tsx translateAndSpeak
  -> provider-specific text cleaning selected in DateSession
  -> utils/ttsRouter.synthesizeSpeech
  -> MiniMax or Fish implementation + shared IndexedDB TTS cache
  -> DateSession in-memory URL cache
  -> HTMLAudioElement playback
```

- `dateVoiceEnabled`, `dateVoiceLang`, current-line emotion, loading state, and playback state live in `DateSession`.
- Synthesis errors are logged and normalized to `null`; manual playback shows an understandable retry toast.
- Effect cleanup sets a local `cancelled` flag and pauses playback. It does **not** abort an in-flight provider request.

### Call

```text
Call greeting / turn / reroll
  -> apps/CallApp.tsx provider branch
  -> Fish: synthesizeSpeechFishDetailed
     MiniMax: inline payload, fetch, cache, long-text split/merge
  -> session object URL tracking
  -> CallApp HTMLAudioElement playback and call state
```

- `CallApp` bypasses `ttsRouter` for historical chunking, cache-key, emotion, and playback reasons.
- MiniMax requests use `stream: false` and `output_format: 'url'`. A failed full request may be split sequentially, then blobs are concatenated before playback. This is chunked batch generation, not progressive playback.
- Fish synthesis is routed through the Fish utility but selected by a direct provider branch.
- A TTS failure keeps the assistant text and reports `TTS失败…已保留文本回复`.
- Playback pause/resume exists; provider-request cancellation does not.

### Provider, settings, persistence, and frontend/backend boundary

- `types.ts`: `TtsProvider` is the closed union `'minimax' | 'fishaudio'`; `APIConfig` contains provider credentials/settings; `CharacterProfile.voiceProfile` contains MiniMax and Fish fields.
- `utils/ttsProvider.ts`: normalization defaults unknown values to MiniMax and maintains module-level provider/prompt state for prompt builders.
- `apps/Settings.tsx`: selects the provider and writes the entire TTS configuration through `updateApiConfig`.
- `context/OSContext.tsx`: reads/writes `os_api_config`, synchronizes the module-level provider, exports `apiConfig` in text/full backup modes, and restores it through `updateApiConfig`.
- `utils/minimaxTts.ts` calls `minimaxFetch`. Web/dev may use the repository's `/api/minimax/t2a` boundary; Capacitor/static behavior is resolved by `utils/minimaxEndpoint.ts`.
- `utils/fishAudioTts.ts` uses `/api/fishaudio/tts` on hosted web, a configured worker route for static deployment, or `CapacitorHttp` on native.
- Existing serverless files proxy official cloud providers. They are not a general local-TTS host contract.
- There is no Electron-style IPC or local native TTS IPC in the current repository.

### Cache and temporary lifecycle

- `utils/ttsCache.ts` stores long-lived raw `Blob` entries in the existing `assets` object store with keys derived from effective provider payloads. It has no automatic eviction.
- Chat additionally persists message-owned audio under `voice_msg_<messageId>` so a voice bar survives remount. Blob object URLs are recreated when hydrating and revoked on discard/unmount.
- Date keeps session URLs in `voiceCacheRef`; Call tracks session blob URLs and revokes them on cleanup.
- Provider-returned remote URLs can be retained as a fallback when browser CORS prevents fetching the blob.

### Request lifecycle, cancellation, errors, loading, and concurrency

- Current requests have no common request ID, AbortSignal, timeout, status stream, or provider-level cancel operation.
- Chat suppresses duplicate generation per message with `voiceLoading`; Date uses per-line loading and a local stale-result flag; Call serializes a turn through call state and sequential chunk generation.
- Multiple app surfaces can synthesize concurrently. The shared cache deduplicates completed equal requests but is not an in-flight deduplicator or scheduler.
- UI loading and failure states are surface-local. There is no provider health state or central queue state.

## 3. Official behavior compatibility map

### MUST_PRESERVE

- MiniMax and Fish Audio synthesis, settings, prompts, voice profiles, cache keys already written, and playback remain functional.
- Unknown/missing old provider setting continues to have an understandable MiniMax-compatible fallback.
- Old `os_api_config`, `CharacterProfile.voiceProfile`, and backup data remain readable with no destructive migration.
- Text responses are committed and visible independently of TTS availability or failure.
- Chat manual/automatic playback rules, Date play/pause behavior, Call text-preserving error behavior, and object-URL cleanup remain understandable.
- Message/Date/Call consumers do not gain engine-name branches.
- Official-compatible export does not depend on fork-only state or remote credentials.

### CAN_EXTEND

- `ttsRouter` can become a registry/facade that covers official cloud providers plus one provider-neutral local-service provider.
- A request ID, AbortSignal, timeout, capabilities, health, status events, and artifact/stream result can be added while retaining a simple URL compatibility wrapper.
- Cache identity can include provider/service/profile/revision without rewriting old entries. Old entries may remain readable; a new key namespace should avoid false cross-provider hits.
- Loading/error UI may consume normalized statuses while preserving current wording and text-only recovery.
- Fork-only endpoint/profile metadata may be isolated under `xiafork_*` after backup policy review.

### ENGINE_SPECIFIC

- Checkpoint paths, Python environment, CUDA settings, model load/warmup, reference-file paths, prompt transcript rules, sampling knobs, emotion implementation, and native engine output format belong only in the host adapter.
- Engine identifiers must not appear in Message, Date, Call, generic settings, cache, fallback, or transport code.

## 4. Minimal provider-neutral contract

`LocalTTSProvider` is the SullyOS-facing provider facade. “Local” means user-owned/local-model infrastructure, **not** “same process, OS, or device.” The facade delegates to a `TtsServiceClient`; the client delegates to a transport; only the host knows the engine adapter.

```ts
type LocalTtsProviderId = 'xiafork-local-tts';
type TtsRequestId = string;
type TtsProfileId = string;

interface LocalTtsCapabilities {
  outputModes: Array<'artifact' | 'chunks'>;
  supportsStreaming: boolean;       // negotiated fact, never assumed
  supportsCancellation: boolean;
  supportsReferenceAudio: boolean;
  supportsPromptTranscript: boolean;
  supportsEmotion: boolean;
  supportsWarmup: boolean;
  supportsPersistentModel: boolean;
  supportsRemoteService: boolean;   // describes service contract support, not exposure
  maxConcurrentInference: number;
}

interface LocalTtsSynthesisRequest {
  requestId: TtsRequestId;
  text: string;
  profileId: TtsProfileId;
  characterId?: string;             // consumer context, not a host filesystem path
  language?: string;
  style?: { emotion?: string; instruction?: string };
  outputPreference?: 'artifact' | 'chunks-if-supported';
  clientCapabilities?: { acceptedMimeTypes?: string[]; acceptsChunks?: boolean };
  options?: { speed?: number; timeoutMs?: number; priority?: 'interactive' | 'normal' };
}

type LocalTtsAudio =
  | { kind: 'artifact'; url: string; mimeType: string; sampleRate?: number; durationMs?: number }
  | { kind: 'chunks'; stream: ReadableStream<Uint8Array>; mimeType: string; sampleRate?: number };

interface LocalTtsSynthesisResult {
  requestId: TtsRequestId;
  audio: LocalTtsAudio;
  timing?: { acceptedAt?: number; firstAudioAt?: number; completedAt?: number };
  providerMetadata?: Record<string, string | number | boolean>;
}

interface LocalTTSProvider {
  readonly id: LocalTtsProviderId;
  readonly displayName: string;
  getCapabilities(): Promise<LocalTtsCapabilities>;
  getStatus(): Promise<{ state: 'available' | 'unavailable' | 'busy' | 'degraded'; detail?: string }>;
  initialize(): Promise<void>;
  synthesize(request: LocalTtsSynthesisRequest, signal?: AbortSignal): Promise<LocalTtsSynthesisResult>;
  cancel(requestId: TtsRequestId): Promise<'accepted' | 'already-terminal' | 'unsupported'>;
  dispose(): Promise<void>;
}
```

Keep the first production version smaller if the selected host cannot support all methods: unsupported behavior is represented by capabilities and normalized results, not by engine-name checks. `initialize` initializes the client/provider connection; it does not require SullyOS to load a model in-process.

## 5. Service and transport boundary

```ts
type TtsTransportConfig =
  | { mode: 'loopback'; endpointId: string }
  | { mode: 'remote'; endpointId: string }; // M8 shape only; not enabled in M2

interface TtsServiceClient {
  describe(): Promise<{ capabilities: LocalTtsCapabilities; hostInstanceId?: string }>;
  submit(envelope: TtsRequestEnvelope, signal?: AbortSignal): AsyncIterable<TtsServiceEvent>;
  cancel(requestId: TtsRequestId): Promise<void>;
}

interface TtsTransport {
  readonly mode: 'loopback' | 'remote';
  connect(signal?: AbortSignal): Promise<void>;
  request(envelope: TtsRequestEnvelope, signal?: AbortSignal): AsyncIterable<TtsServiceEvent>;
  close(): Promise<void>;
}
```

Rules:

- The engine provider/adapter and network transport are separate concepts.
- Production consumers receive a provider facade, never a URL or Python process handle.
- Endpoint resolution occurs once in a transport factory. No consumer hard-codes `127.0.0.1` or a public URL.
- M2 loopback may use a local service, but its endpoint is configured/derived behind `TtsTransport`.
- `remote` is a reserved future configuration shape. It must remain disabled and unimplemented until M8 authorization and security review.

## 6. Loopback architecture (future M2 production)

```text
Message / Date / Call
  -> ttsRouter / LocalTTSProvider
  -> TtsServiceClient
  -> LoopbackTransport
  -> user-owned TTS host process
  -> selected EngineAdapter
  -> persistent local model + GPU
```

SullyOS only sends a logical profile ID. The host maps it to reference assets and engine configuration. The browser must not learn checkpoint paths, Python environments, or CUDA details.

## 7. Private Xia Yizhou voice-cloud architecture (future M8)

```text
Phone / tablet / external laptop SullyOS
  -> unchanged LocalTTSProvider consumer contract
  -> TtsServiceClient
  -> future authenticated encrypted RemoteTransport
  -> user's home-PC TTS host
  -> queue + selected EngineAdapter + resident GPU model
  -> request-owned audio events back to the originating client only
```

The model weights, checkpoints, reference assets, Python environment, and GPU stay on the home PC. Remote devices need none of them. This diagram is a compatibility target, not an implemented connection.

## 8. Future request, event, and isolation contract

```ts
interface TtsRequestEnvelope {
  protocolVersion: number;
  requestId: string;
  client: { clientInstanceId: string; deviceId: string };
  profileId: string;
  text: string;
  language?: string;
  style?: { emotion?: string; instruction?: string };
  priority?: 'interactive' | 'normal';
  streamPreference?: 'artifact' | 'chunks-if-supported';
  clientCapabilities?: { acceptedMimeTypes?: string[]; acceptsChunks?: boolean };
}

type TtsServiceEvent =
  | { type: 'accepted'; requestId: string; clientInstanceId: string }
  | { type: 'queued'; requestId: string; clientInstanceId: string; position?: number }
  | { type: 'generating'; requestId: string; clientInstanceId: string }
  | { type: 'first-audio-ready'; requestId: string; clientInstanceId: string; mimeType: string }
  | { type: 'audio-chunk'; requestId: string; clientInstanceId: string; sequence: number; bytes: Uint8Array }
  | { type: 'artifact'; requestId: string; clientInstanceId: string; artifactId: string; mimeType: string }
  | { type: 'completed'; requestId: string; clientInstanceId: string }
  | { type: 'cancelled'; requestId: string; clientInstanceId: string }
  | { type: 'failed'; requestId: string; clientInstanceId: string; code: string; retryable: boolean };
```

The host binds every request to the authenticated client identity from the connection, not merely to a caller-supplied device string. Every event carries and is routed by that ownership. A request from device A must never be subscribed, fetched, cancelled, or acknowledged by device B without an explicitly authorized cross-device control feature.

## 9. Host/client responsibility map

| TTS host (home PC) | SullyOS client |
| --- | --- |
| Model and checkpoint files | Request creation and unique request ID |
| Reference/profile files and logical profile mapping | Character-to-logical-profile selection |
| Python/CUDA/runtime environment | UI loading/queued/generating/playback state |
| Engine adapter and model warm state | Capability negotiation and playback |
| Synthesis queue and bounded workers | Cancellation request and stale-result rejection |
| Audio generation/encoding/artifact lifecycle | Timeout/fallback UX |
| Provider health and model availability | Endpoint/device configuration without host filesystem paths |

The remote client must not know checkpoint paths, Python environment names, CUDA versions, adapter modules, or engine-native payloads.

## 10. Adapter difference map (no winner decision)

### COMMON_CONTRACT

- Long-lived host process constructs the selected engine once, keeps model state resident where possible, accepts text plus a logical voice profile, produces audio, reports health/capabilities, and normalizes errors.
- The host resolves profile IDs to local reference assets. It validates text, language, output format, cancellation capability, and request ownership.
- Both adapters return a provider-neutral artifact or chunk sequence and never expose checkpoint paths to SullyOS.

### INDEXTTS2_ADAPTER_ONLY

- Startup constructs `IndexTTS2` from a model directory/config and loads its component models. The inspected WebUI creates one persistent instance at startup.
- Core input is `spk_audio_prompt` plus `text`; output is normally written to a WAV `output_path` or yielded as `(sampling_rate, wav_data)` when no output path is supplied.
- Emotion can come from a separate emotion reference, an emotion vector, or emotion text controls. These are adapter options behind the generic style/profile contract.
- Speaker/emotion conditioning is cached inside the persistent instance when reference paths do not change.
- `infer_generator` yields internal audio tensors/chunks, but the inspected standard WebUI waits for the output file. A production service must validate chunk safety and latency before advertising `supportsStreaming=true`; current external-service streaming is **unverified**, not assumed.
- No first-party standalone FastAPI service entrypoint was found at the inspected root. A host wrapper/process boundary is therefore an integration concern.

### GPT_SOVITS_ADAPTER_ONLY

- Startup uses both a GPT/T2S checkpoint and a SoVITS/VITS checkpoint plus pretrained supporting models. The TTS class retains loaded models and prompt/reference caches in a persistent process.
- Core input includes target text/language and reference audio. Prompt transcript and prompt language are part of the API contract; prompt text is optional in some modes but required by some model configurations (the inspected implementation explicitly rejects empty prompt text for a V3 vocoder path).
- Adapter/profile data may include auxiliary references, sampling/splitting/speed controls, and the paired fine-tuned checkpoint selection. These never enter generic consumers.
- `api_v2.py` exposes full-audio and several streaming modes, and the inference generator can yield fragments. Streaming quality/speed and availability depend on mode/model configuration; the adapter must negotiate and test the selected configuration before advertising support.
- Existing endpoints that switch GPT/SoVITS weight paths are host-administration details and must not be exposed to ordinary SullyOS synthesis clients.

## 11. Capability matrix

`yes/no/unverified/config-dependent` is deliberate; M1 benchmarks and M2-P1 host validation must replace unknowns with measured facts.

| Capability | IndexTTS2 inspected tree | GPT-SoVITS inspected tree | Generic contract behavior |
| --- | --- | --- | --- |
| Reference audio | yes | yes | logical `profileId`; host resolves files |
| Prompt transcript | not required by inspected main infer signature | version/config-dependent | optional generic profile capability |
| Emotion/style | reference/vector/text controls | engine/profile-specific | normalized optional style |
| Persistent model | yes, persistent instance intended | yes, persistent TTS instance intended | host capability |
| Warmup | feasible, exact procedure unverified | feasible, exact procedure unverified | optional host action |
| Cancellation | no safe public primitive verified | no safe request cancellation primitive verified | advertise false until implemented/tested |
| True progressive service streaming | unverified | available in conditional API modes | negotiate; artifact fallback mandatory |
| Remote service | no secure remote contract inspected | raw API is not the required secure remote contract | false until M8 security layer exists |
| Output | WAV path or sample-rate/audio data | WAV/raw/OGG/AAC, full or conditional chunks | normalized MIME + artifact/chunks |

## 12. Future remote security requirements (design only)

- Authenticated, encrypted transport (TLS or an equivalently secure authenticated channel); never a naked public TTS endpoint.
- Per-device enrollment, authorization, identity-bound request ownership, and revocation.
- Secrets remain in an appropriate credential store, are never logged, and are not included in official-compatible backups.
- Unique request IDs, protocol-version validation, replay resistance where applicable, and strict response-to-client routing.
- Bounded text size, request size, queue depth, per-device/global rate limits, timeouts, and artifact expiry.
- Cancellation authorization: a device may cancel only its owned request unless a separate privileged control is explicitly designed.
- Explicit host-offline, busy, queue-full, timeout, model-unavailable, protocol-mismatch, unauthorized, and revoked-device errors.
- Logs redact text by default where practical and never contain credentials, tokens, raw authentication headers, checkpoint secrets, or unnecessary reference audio.
- Model weights and reference assets never need to leave the host.
- No cloud/vendor/tunnel/VPN/reverse-proxy choice is made here.

## 13. Streaming and latency compatibility

- The result union and service event stream allow `accepted -> queued -> generating -> first-audio-ready -> audio-chunk* -> completed` without forcing every engine to stream.
- A non-stream provider returns an artifact and remains fully compatible. The client must not emulate “streaming” by assuming sequential full files are gapless.
- `supportsStreaming` is runtime-negotiated per host/adapter configuration. A preference is not a requirement.
- Chunk sequencing, MIME/sample-rate stability, first-chunk framing, backpressure, cancellation, partial-playback cleanup, and terminal-event semantics need contract tests before enabling chunks.
- First-packet latency and total synthesis time are distinct timing fields. Do not infer either from UI loading duration.

## 14. Host offline and fallback hooks

The provider returns normalized unavailable/offline/timeout/busy/model-unavailable states. A separate fallback policy decides among:

- an existing official provider,
- another configured provider, or
- text-only behavior.

M2-P0 does not select a default fallback. All policies must preserve the already-produced text, avoid retry loops or duplicate speech, and explain the state to the user. Message/Date/Call invoke one fallback coordinator rather than adding engine branches.

## 15. Queue and concurrency requirements for future M8

- Host state is at least `queued | running | completed | cancelled | failed`, keyed by request ID and authenticated client ownership.
- Queue depth is bounded. Queue-full is explicit and retryable according to host policy.
- A queued request can be removed immediately by its owner. Running cancellation is capability-dependent and may resolve as accepted, unsupported, or already terminal.
- Default single-GPU behavior may be one inference worker. Multiple workers are a declared host capability, not a client assumption.
- Scheduling may consider interactive/normal priority but must prevent starvation and enforce per-device/global limits.
- Terminal results/events are idempotent. Late chunks after cancellation or timeout are discarded by both service client and UI ownership checks.

No scheduler or server is implemented by this preparation.

## 16. Exact M2-P1 production patch map (after M1 winner)

### ADD

- `utils/localTts/contracts.ts`: the minimal request/result/capability/status contracts, trimmed to winner/host facts.
- `utils/localTts/provider.ts`: `LocalTTSProvider` facade implementing the generic router contract.
- `utils/localTts/serviceClient.ts`: service event normalization, request ownership, timeout, cancellation, and artifact/chunk conversion.
- `utils/localTts/transports/loopbackTransport.ts`: the only enabled M2 transport; central endpoint resolution and AbortSignal propagation.
- `utils/localTts/providerRegistry.ts`: registration/lookup without consumer engine branches.
- `utils/localTts/fallback.ts`: normalized failure-to-policy hook; no default policy change without product approval.
- `utils/localTts/*.test.ts`: fake provider/transport contract tests.
- Host adapter files in an isolated Xiafork host boundary selected after packaging review; engine-specific code must not be placed in Message/Date/Call.

### MODIFY

- `utils/ttsRouter.ts`: preserve current wrappers, route through a registry, accept request IDs/signals, and normalize official/local results.
- `utils/ttsProvider.ts`: preserve old MiniMax default semantics while resolving the new provider registration without engine names.
- `types.ts`: add only approved provider/service/profile configuration types; retain all official fields and meanings.
- `utils/apiConfigNormalize.ts`: validate new optional config while preserving unknown/old official fields.
- `context/OSContext.tsx`: load/sync/save isolated optional configuration only after the persistence/backup review below.
- `apps/Settings.tsx`: add a generic local-service provider and loopback health/config UI; no engine-specific UI.
- `apps/Character.tsx`: map a character to a logical local voice profile ID if required; never expose checkpoint paths.
- `apps/Chat.tsx`: rename provider-specific readiness variables and pass request ID/signal to the router while preserving message assets/playback behavior.
- `components/date/DateSession.tsx`: move provider-specific cleaning behind the router and use real cancellation/stale-result checks.
- `apps/CallApp.tsx`: remove the historical direct provider branch by moving chunk/result behavior behind the same router contract; preserve call playback/cache/text fallback.
- `utils/ttsCache.ts`: include provider/service/profile revision in new cache identities and define compatibility with existing keys.

### REGISTER

- Register official MiniMax and Fish adapters plus one `xiafork-local-tts` provider in `utils/localTts/providerRegistry.ts`; register the selected engine only inside the host's adapter factory.

### SETTINGS AND PERSISTENCE REVIEW

- Official structures affected if `APIConfig` is extended: `os_api_config`, `FullBackupData.apiConfig`, export/import, and old settings normalization.
- Backward: all new fields optional; missing means official behavior. No DB migration.
- Forward: preserve unknown fields; official-compatible mode must not require or leak fork-only endpoint/auth data.
- Round trip: non-secret fork metadata needs an explicit Official-Compatible vs Xiafork Extended policy. Credentials are excluded or handled by a separately approved credential export.
- Rollback: selecting an official provider must work even if fork config is absent/stale. Removing fork config must not damage official voice fields.
- Preferred isolation: a reviewed `xiafork_*` setting/sidecar for host profiles and endpoint metadata rather than making fork state mandatory inside official fields.

### MESSAGE / FALLBACK

- `apps/Chat.tsx`, `components/date/DateSession.tsx`, and `apps/CallApp.tsx` consume only router statuses/results.
- Official provider failures retain their current understandable behavior. Local-host failure invokes the configured fallback hook or text-only behavior without losing chat text.

### TEST

- `utils/localTts/contracts.test.ts`, `providerRegistry.test.ts`, `serviceClient.test.ts`, `loopbackTransport.test.ts`, and `fallback.test.ts` with fake audio and fake transport only.
- Target current seams with existing `utils/voicePlayback.test.ts`, provider normalization tests, Chat/Date/Call extracted pure helpers, settings normalization tests, and backup round-trip tests.

## 17. M8 private voice-cloud future patch map

M8 extends the service client/transport seam, not Message/UI:

### ADD

- `utils/localTts/transports/remoteTransport.ts`: authenticated encrypted request/event transport with identity binding and replay/timeout handling.
- `utils/localTts/deviceIdentity.ts`: approved device enrollment/identity abstraction; no raw secret logging.
- `utils/localTts/remoteErrors.ts`: normalized offline/busy/queue-full/revoked/protocol errors.
- `utils/localTts/transports/remoteTransport.test.ts`: fake transport tests for two-client isolation, replay rejection, timeout, revocation, chunk ordering, and cancellation ownership.
- Host-side authentication, authorization, bounded queue, artifact ownership/expiry, audit redaction, and transport adapters in the isolated host project/boundary.

### MODIFY

- `utils/localTts/provider.ts`: select loopback or remote `TtsTransport` from generic endpoint configuration.
- `utils/localTts/serviceClient.ts`: retain the same request/event contract and enforce authenticated client ownership.
- `apps/Settings.tsx`: device enrollment/status/revocation UI only after security and persistence design approval.
- `context/OSContext.tsx` and backup code only according to the approved non-secret metadata policy; credentials remain outside official-compatible export.

`apps/Chat.tsx`, `components/date/DateSession.tsx`, `apps/CallApp.tsx`, and `components/chat/MessageItem.tsx` should require no engine or remote-host rewrite. At most they consume richer normalized queue/offline status already exposed by the provider facade.

## 18. Targeted test plan

All tests use fake/mock providers, fake audio metadata, and fake transports. No GPU, model, or real network is permitted.

| Area | Required assertions |
| --- | --- |
| Availability/init | available, unavailable, init success/failure, dispose idempotence |
| Synthesis | success artifact, chunk success, provider failure, malformed result, empty text rejection |
| Cancellation | queued cancel, running supported/unsupported, AbortSignal propagation, late chunk ignored |
| Official compatibility | missing provider still MiniMax; MiniMax/Fish registrations remain; old settings/profile fixtures read unchanged |
| Fallback | official fallback hook, text-only hook, no retry loop, text result retained |
| Persistence | optional fork config absent/present, rollback, unknown fields preserved, secrets excluded from official-compatible backup |
| Request isolation | unique request IDs, stale response rejected, device A cannot receive/fetch/cancel device B output |
| Host state | offline, timeout, busy, queue full, model unavailable, retryable classification |
| Streaming | capability negotiation, non-stream artifact compatibility, chunk order, first-audio event, terminal event, backpressure/error cleanup |
| Concurrency | bounded queue, ownership through queued/running/completed, one-worker ordering, no cross-client cache/result leak |
| Consumer neutrality | no engine-specific branch in Chat/Date/Call; provider differences remain inside adapters |

M2-P0 adds no runtime code, so no fake harness is checked in during this phase. The first M2-P1 contract commit should add types and fake tests before wiring a production consumer.

## 19. Explicit non-goals

- No M1 winner decision.
- No IndexTTS2 or GPT-SoVITS production adapter.
- No model startup, inference, benchmark, GPU use, model download, or dependency/lockfile change.
- No production TTS default or existing behavior change.
- No public listener, public URL, tunnel, VPN, NAT traversal, reverse proxy, account system, cloud deployment, or Internet exposure.
- No remote mode implementation, scheduler, server deployment, credential handling, or W3-P1 takeover.
- No IndexedDB schema/version change, migration, or backup-format extension.

