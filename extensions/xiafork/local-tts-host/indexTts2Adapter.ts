import { BaseTtsEngineAdapter } from './baseAdapter';
import type {
  HostArtifactStore,
  HostTtsSynthesisRequest,
  TtsEngineCapabilities,
} from './contracts';
import { TtsAdapterError } from './contracts';
import type { TtsEngineProcess } from './processBoundary';
import { HostTtsProfileRegistry, type IndexTts2HostProfile } from './profiles';

export interface IndexTts2AdapterConfig {
  modelDirectory: string;
  configPath: string;
  auxModelPaths: Readonly<Record<string, string>>;
  device?: string;
  useFp16?: boolean;
}

export interface IndexTts2ProcessInitialize {
  modelDirectory: string;
  configPath: string;
  auxModelPaths: Readonly<Record<string, string>>;
  device?: string;
  useFp16: boolean;
  allowDownloads: false;
}

export interface IndexTts2ProcessSynthesis {
  requestId: string;
  text: string;
  speakerReferenceAudioPath: string;
  language?: string;
  streamReturn: false;
  emotionReferenceAudioPath?: string;
  emotionVector?: readonly number[];
  emotionText?: string;
  emotionWeight?: number;
}

export class IndexTTS2Adapter extends BaseTtsEngineAdapter<IndexTts2ProcessInitialize, IndexTts2ProcessSynthesis> {
  constructor(
    private readonly config: IndexTts2AdapterConfig,
    private readonly profiles: HostTtsProfileRegistry,
    process: TtsEngineProcess<IndexTts2ProcessInitialize, IndexTts2ProcessSynthesis>,
    artifacts: HostArtifactStore,
  ) {
    super('indextts2', process, artifacts);
  }

  async getCapabilities(): Promise<TtsEngineCapabilities> {
    return {
      outputModes: ['artifact'],
      supportsStreaming: false,
      supportsCancellation: false,
      supportsReferenceAudio: true,
      supportsPromptTranscript: false,
      supportsEmotion: true,
      supportsWarmup: false,
      supportsPersistentModel: true,
      supportsRemoteService: false,
      maxConcurrentInference: 1,
    };
  }

  protected buildInitializeConfig(): IndexTts2ProcessInitialize {
    const modelDirectory = this.requireNonEmpty(this.config.modelDirectory, 'modelDirectory');
    const configPath = this.requireNonEmpty(this.config.configPath, 'configPath');
    const auxEntries = Object.entries(this.config.auxModelPaths || {});
    if (!auxEntries.length || auxEntries.some(([key, value]) => !key.trim() || !value.trim())) {
      throw new TtsAdapterError(
        'CONFIG_INVALID',
        'IndexTTS2 auxiliary model paths must be pre-resolved.',
      );
    }
    return {
      modelDirectory,
      configPath,
      auxModelPaths: Object.fromEntries(auxEntries),
      device: this.config.device?.trim() || undefined,
      useFp16: this.config.useFp16 === true,
      allowDownloads: false,
    };
  }

  protected buildSynthesisRequest(request: HostTtsSynthesisRequest): IndexTts2ProcessSynthesis {
    const profile = this.profiles.resolveIndexTts2(request.profileId);
    if (!profile) this.profileNotFound(request);
    this.validateProfile(profile);

    const emotionText = request.style?.instruction?.trim() || request.style?.emotion?.trim();
    const native: IndexTts2ProcessSynthesis = {
      requestId: request.requestId,
      text: request.text.trim(),
      speakerReferenceAudioPath: profile.referenceAudioPath.trim(),
      language: request.language?.trim() || undefined,
      streamReturn: false,
    };

    if (emotionText) {
      native.emotionText = emotionText;
    } else if (profile.emotion?.mode === 'reference-audio') {
      native.emotionReferenceAudioPath = profile.emotion.referenceAudioPath.trim();
      native.emotionWeight = profile.emotion.weight;
    } else if (profile.emotion?.mode === 'vector') {
      native.emotionVector = [...profile.emotion.values];
      native.emotionWeight = profile.emotion.weight;
    } else if (profile.emotion?.mode === 'text') {
      native.emotionText = profile.emotion.instruction?.trim() || request.text.trim();
      native.emotionWeight = profile.emotion.weight;
    }
    return native;
  }

  private validateProfile(profile: IndexTts2HostProfile): void {
    this.requireNonEmpty(profile.referenceAudioPath, 'profile.referenceAudioPath');
    if (profile.emotion?.mode === 'reference-audio') {
      this.requireNonEmpty(profile.emotion.referenceAudioPath, 'profile.emotion.referenceAudioPath');
    }
    if (profile.emotion?.mode === 'vector') {
      const values = profile.emotion.values;
      if (values.length !== 8 || values.some(value => !Number.isFinite(value) || value < 0)) {
        throw new TtsAdapterError(
          'CONFIG_INVALID',
          'IndexTTS2 emotion vector must contain eight non-negative values.',
        );
      }
    }
  }
}
