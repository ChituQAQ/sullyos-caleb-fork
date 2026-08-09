import { BaseTtsEngineAdapter } from './baseAdapter';
import type {
  HostArtifactStore,
  HostTtsSynthesisRequest,
  TtsEngineCapabilities,
} from './contracts';
import type { TtsEngineProcess } from './processBoundary';
import { HostTtsProfileRegistry, type GptSoVitsHostProfile } from './profiles';

export interface GptSoVitsAdapterConfig {
  runtimeConfigPath: string;
  device?: string;
  useHalfPrecision?: boolean;
}

export interface GptSoVitsProcessInitialize {
  runtimeConfigPath: string;
  device?: string;
  useHalfPrecision: boolean;
  allowDownloads: false;
}

export interface GptSoVitsProcessSynthesis {
  requestId: string;
  text: string;
  textLanguage: string;
  referenceAudioPath: string;
  promptText: string;
  promptLanguage: string;
  gptCheckpointPath: string;
  sovitsCheckpointPath: string;
  streamingMode: false;
  returnFragment: false;
}

export class GPTSoVITSAdapter extends BaseTtsEngineAdapter<GptSoVitsProcessInitialize, GptSoVitsProcessSynthesis> {
  constructor(
    private readonly config: GptSoVitsAdapterConfig,
    private readonly profiles: HostTtsProfileRegistry,
    process: TtsEngineProcess<GptSoVitsProcessInitialize, GptSoVitsProcessSynthesis>,
    artifacts: HostArtifactStore,
  ) {
    super('gpt-sovits', process, artifacts);
  }

  async getCapabilities(): Promise<TtsEngineCapabilities> {
    return {
      outputModes: ['artifact'],
      supportsStreaming: false,
      supportsCancellation: false,
      supportsReferenceAudio: true,
      supportsPromptTranscript: true,
      supportsEmotion: false,
      supportsWarmup: false,
      supportsPersistentModel: true,
      supportsRemoteService: false,
      maxConcurrentInference: 1,
    };
  }

  protected buildInitializeConfig(): GptSoVitsProcessInitialize {
    return {
      runtimeConfigPath: this.requireNonEmpty(this.config.runtimeConfigPath, 'runtimeConfigPath'),
      device: this.config.device?.trim() || undefined,
      useHalfPrecision: this.config.useHalfPrecision === true,
      allowDownloads: false,
    };
  }

  protected buildSynthesisRequest(request: HostTtsSynthesisRequest): GptSoVitsProcessSynthesis {
    const profile = this.profiles.resolveGptSoVits(request.profileId);
    if (!profile) this.profileNotFound(request);
    this.validateProfile(profile);
    const language = request.language?.trim() || profile.promptLanguage.trim();
    return {
      requestId: request.requestId,
      text: request.text.trim(),
      textLanguage: language,
      referenceAudioPath: profile.referenceAudioPath.trim(),
      promptText: profile.promptText.trim(),
      promptLanguage: profile.promptLanguage.trim(),
      gptCheckpointPath: profile.gptCheckpointPath.trim(),
      sovitsCheckpointPath: profile.sovitsCheckpointPath.trim(),
      streamingMode: false,
      returnFragment: false,
    };
  }

  private validateProfile(profile: GptSoVitsHostProfile): void {
    this.requireNonEmpty(profile.referenceAudioPath, 'profile.referenceAudioPath');
    this.requireNonEmpty(profile.promptText, 'profile.promptText');
    this.requireNonEmpty(profile.promptLanguage, 'profile.promptLanguage');
    this.requireNonEmpty(profile.gptCheckpointPath, 'profile.gptCheckpointPath');
    this.requireNonEmpty(profile.sovitsCheckpointPath, 'profile.sovitsCheckpointPath');
  }
}
