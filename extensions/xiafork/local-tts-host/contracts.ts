export type TtsEngineAdapterId = 'indextts2' | 'gpt-sovits';

export type HostTtsOutputPreference = 'artifact' | 'chunks-if-supported';

export interface HostTtsSynthesisRequest {
  requestId: string;
  text: string;
  profileId: string;
  language?: string;
  style?: {
    emotion?: string;
    instruction?: string;
  };
  outputPreference?: HostTtsOutputPreference;
}

export interface TtsEngineCapabilities {
  outputModes: Array<'artifact' | 'chunks'>;
  supportsStreaming: boolean;
  supportsCancellation: boolean;
  supportsReferenceAudio: boolean;
  supportsPromptTranscript: boolean;
  supportsEmotion: boolean;
  supportsWarmup: boolean;
  supportsPersistentModel: boolean;
  supportsRemoteService: boolean;
  maxConcurrentInference: number;
}

export type TtsEngineStatus =
  | { state: 'uninitialized' }
  | { state: 'initializing' }
  | { state: 'available' }
  | { state: 'unavailable'; detail: string }
  | { state: 'disposed' };

export interface HostTtsArtifact {
  kind: 'artifact';
  artifactId: string;
  mimeType: string;
  sampleRate?: number;
  durationMs?: number;
}

export interface HostTtsSynthesisResult {
  requestId: string;
  audio: HostTtsArtifact;
}

export type TtsCancelResult = 'unsupported' | 'already-terminal';

export interface TtsEngineAdapter {
  readonly id: TtsEngineAdapterId;
  initialize(): Promise<void>;
  getCapabilities(): Promise<TtsEngineCapabilities>;
  getStatus(): Promise<TtsEngineStatus>;
  synthesize(request: HostTtsSynthesisRequest): Promise<HostTtsSynthesisResult>;
  cancel(requestId: string): Promise<TtsCancelResult>;
  dispose(): Promise<void>;
}

export type EngineAudioOutput =
  | {
      kind: 'path';
      path: string;
      mimeType: string;
      sampleRate?: number;
      durationMs?: number;
    }
  | {
      kind: 'bytes';
      bytes: Uint8Array;
      mimeType: string;
      sampleRate?: number;
      durationMs?: number;
    };

export interface HostArtifactStore {
  publish(input: {
    requestId: string;
    source: EngineAudioOutput;
  }): Promise<{
    artifactId: string;
    mimeType: string;
    sampleRate?: number;
    durationMs?: number;
  }>;
}

export type TtsAdapterErrorCode =
  | 'CONFIG_INVALID'
  | 'PROFILE_NOT_FOUND'
  | 'REQUEST_INVALID'
  | 'NOT_INITIALIZED'
  | 'ADAPTER_DISPOSED'
  | 'INITIALIZATION_FAILED'
  | 'SYNTHESIS_FAILED'
  | 'INVALID_ENGINE_RESULT';

export class TtsAdapterError extends Error {
  readonly name = 'TtsAdapterError';

  constructor(
    readonly code: TtsAdapterErrorCode,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
