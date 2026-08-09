import {
  HostArtifactStore,
  HostTtsSynthesisRequest,
  HostTtsSynthesisResult,
  TtsAdapterError,
  TtsEngineAdapter,
  TtsEngineAdapterId,
  TtsEngineCapabilities,
  TtsEngineStatus,
  type EngineAudioOutput,
  type TtsCancelResult,
} from './contracts';
import type { TtsEngineProcess } from './processBoundary';

export abstract class BaseTtsEngineAdapter<TInitialize, TSynthesis> implements TtsEngineAdapter {
  private status: TtsEngineStatus = { state: 'uninitialized' };
  private processStarted = false;

  protected constructor(
    readonly id: TtsEngineAdapterId,
    private readonly process: TtsEngineProcess<TInitialize, TSynthesis>,
    private readonly artifacts: HostArtifactStore,
  ) {}

  abstract getCapabilities(): Promise<TtsEngineCapabilities>;

  async getStatus(): Promise<TtsEngineStatus> {
    return { ...this.status };
  }

  async initialize(): Promise<void> {
    if (this.status.state === 'available') return;
    if (this.status.state === 'disposed') {
      throw new TtsAdapterError('ADAPTER_DISPOSED', 'The TTS engine adapter is disposed.');
    }
    if (this.status.state === 'initializing') {
      throw new TtsAdapterError('INITIALIZATION_FAILED', 'The TTS engine adapter is already initializing.');
    }

    const config = this.buildInitializeConfig();
    this.status = { state: 'initializing' };
    this.processStarted = true;
    try {
      await this.process.initialize(config);
      this.status = { state: 'available' };
    } catch {
      this.status = { state: 'unavailable', detail: 'Engine initialization failed.' };
      throw new TtsAdapterError('INITIALIZATION_FAILED', 'TTS engine initialization failed.');
    }
  }

  async synthesize(request: HostTtsSynthesisRequest): Promise<HostTtsSynthesisResult> {
    this.assertRequest(request);
    if (this.status.state === 'disposed') {
      throw new TtsAdapterError('ADAPTER_DISPOSED', 'The TTS engine adapter is disposed.', request.requestId);
    }
    if (this.status.state !== 'available') {
      throw new TtsAdapterError('NOT_INITIALIZED', 'The TTS engine adapter is not available.', request.requestId);
    }

    let output: EngineAudioOutput;
    try {
      output = await this.process.synthesize(this.buildSynthesisRequest(request));
    } catch (error) {
      if (error instanceof TtsAdapterError) throw error;
      throw new TtsAdapterError('SYNTHESIS_FAILED', 'TTS engine synthesis failed.', request.requestId);
    }
    this.assertEngineOutput(output, request.requestId);

    try {
      const artifact = await this.artifacts.publish({ requestId: request.requestId, source: output });
      if (!artifact.artifactId.trim() || !artifact.mimeType.trim()) {
        throw new Error('invalid artifact');
      }
      return {
        requestId: request.requestId,
        audio: { kind: 'artifact', ...artifact },
      };
    } catch (error) {
      if (error instanceof TtsAdapterError) throw error;
      throw new TtsAdapterError('INVALID_ENGINE_RESULT', 'TTS audio artifact normalization failed.', request.requestId);
    }
  }

  async cancel(_requestId: string): Promise<TtsCancelResult> {
    return 'unsupported';
  }

  async dispose(): Promise<void> {
    if (this.status.state === 'disposed') return;
    try {
      if (this.processStarted) await this.process.dispose();
    } finally {
      this.status = { state: 'disposed' };
    }
  }

  protected abstract buildInitializeConfig(): TInitialize;
  protected abstract buildSynthesisRequest(request: HostTtsSynthesisRequest): TSynthesis;

  protected requireNonEmpty(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TtsAdapterError('CONFIG_INVALID', `Host TTS config field ${field} is required.`);
    }
    return value.trim();
  }

  protected profileNotFound(request: HostTtsSynthesisRequest): never {
    throw new TtsAdapterError('PROFILE_NOT_FOUND', 'The requested host voice profile is unavailable.', request.requestId);
  }

  private assertRequest(request: HostTtsSynthesisRequest): void {
    if (!request || typeof request.requestId !== 'string' || !request.requestId.trim()) {
      throw new TtsAdapterError('REQUEST_INVALID', 'A non-empty requestId is required.');
    }
    if (typeof request.text !== 'string' || !request.text.trim()) {
      throw new TtsAdapterError('REQUEST_INVALID', 'Synthesis text is required.', request.requestId);
    }
    if (typeof request.profileId !== 'string' || !request.profileId.trim()) {
      throw new TtsAdapterError('REQUEST_INVALID', 'A host voice profile id is required.', request.requestId);
    }
    if (request.outputPreference === 'chunks-if-supported') {
      throw new TtsAdapterError(
        'REQUEST_INVALID',
        'This adapter prototype supports artifact output only.',
        request.requestId,
      );
    }
  }

  private assertEngineOutput(output: EngineAudioOutput, requestId: string): void {
    const validPath = output?.kind === 'path' && typeof output.path === 'string' && !!output.path.trim();
    const validBytes = output?.kind === 'bytes' && output.bytes instanceof Uint8Array && output.bytes.byteLength > 0;
    if ((!validPath && !validBytes) || typeof output.mimeType !== 'string' || !output.mimeType.trim()) {
      throw new TtsAdapterError('INVALID_ENGINE_RESULT', 'TTS engine returned no usable audio.', requestId);
    }
  }
}
