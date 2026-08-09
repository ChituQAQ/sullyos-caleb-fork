import { describe, expect, it } from 'vitest';
import type {
  EngineAudioOutput,
  HostArtifactStore,
  HostTtsSynthesisRequest,
  TtsEngineAdapter,
} from './contracts';
import { TtsAdapterError } from './contracts';
import {
  GPTSoVITSAdapter,
  type GptSoVitsProcessInitialize,
  type GptSoVitsProcessSynthesis,
} from './gptSoVitsAdapter';
import {
  IndexTTS2Adapter,
  type IndexTts2ProcessInitialize,
  type IndexTts2ProcessSynthesis,
} from './indexTts2Adapter';
import type { TtsEngineProcess } from './processBoundary';
import { HostTtsProfileRegistry } from './profiles';

class FakeEngineProcess<TInitialize, TSynthesis> implements TtsEngineProcess<TInitialize, TSynthesis> {
  initializeCalls: TInitialize[] = [];
  synthesisCalls: TSynthesis[] = [];
  disposeCalls = 0;
  initializeError: Error | null = null;
  synthesisError: Error | null = null;
  output: EngineAudioOutput = {
    kind: 'path',
    path: '/host/private/request.wav',
    mimeType: 'audio/wav',
    sampleRate: 32000,
    durationMs: 1200,
  };

  async initialize(config: TInitialize): Promise<void> {
    this.initializeCalls.push(config);
    if (this.initializeError) throw this.initializeError;
  }

  async synthesize(request: TSynthesis): Promise<EngineAudioOutput> {
    this.synthesisCalls.push(request);
    if (this.synthesisError) throw this.synthesisError;
    return this.output;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }
}

class FakeArtifactStore implements HostArtifactStore {
  published: Array<{ requestId: string; source: EngineAudioOutput }> = [];

  async publish(input: { requestId: string; source: EngineAudioOutput }) {
    this.published.push(input);
    return {
      artifactId: `artifact-${input.requestId}`,
      mimeType: input.source.mimeType,
      sampleRate: input.source.sampleRate,
      durationMs: input.source.durationMs,
    };
  }
}

const genericRequest = (): HostTtsSynthesisRequest => ({
  requestId: 'request-001',
  text: '你好。',
  profileId: 'xiazhou-default',
  language: 'zh',
  style: { emotion: 'calm' },
  outputPreference: 'artifact',
});

function runSharedConformance(
  label: string,
  create: () => {
    adapter: TtsEngineAdapter;
    process: FakeEngineProcess<unknown, unknown>;
    artifacts: FakeArtifactStore;
  },
) {
  describe(`${label} shared conformance`, () => {
    it('initializes once and reports a persistent available engine', async () => {
      const { adapter, process } = create();
      expect(await adapter.getStatus()).toEqual({ state: 'uninitialized' });
      await adapter.initialize();
      await adapter.initialize();
      expect(process.initializeCalls).toHaveLength(1);
      expect(await adapter.getStatus()).toEqual({ state: 'available' });
      expect((await adapter.getCapabilities()).supportsPersistentModel).toBe(true);
    });

    it('preserves requestId and hides engine paths from the generic result', async () => {
      const { adapter, artifacts } = create();
      await adapter.initialize();
      const result = await adapter.synthesize(genericRequest());
      expect(result).toEqual({
        requestId: 'request-001',
        audio: {
          kind: 'artifact',
          artifactId: 'artifact-request-001',
          mimeType: 'audio/wav',
          sampleRate: 32000,
          durationMs: 1200,
        },
      });
      expect(JSON.stringify(result)).not.toContain('/host/private');
      expect(artifacts.published[0].source.kind).toBe('path');
    });

    it('normalizes engine exceptions without leaking native details', async () => {
      const { adapter, process } = create();
      await adapter.initialize();
      process.synthesisError = new Error('/host/private/model.ckpt failed with CUDA internals');
      await expect(adapter.synthesize(genericRequest())).rejects.toMatchObject({
        code: 'SYNTHESIS_FAILED',
        requestId: 'request-001',
        message: 'TTS engine synthesis failed.',
      });
    });

    it('rejects unusable engine output before exposing it to the consumer', async () => {
      const { adapter, process, artifacts } = create();
      process.output = { kind: 'bytes', bytes: new Uint8Array(), mimeType: 'audio/wav' };
      await adapter.initialize();
      await expect(adapter.synthesize(genericRequest())).rejects.toMatchObject({
        code: 'INVALID_ENGINE_RESULT',
        requestId: 'request-001',
      });
      expect(artifacts.published).toHaveLength(0);
    });

    it('reports unavailable initialization and normalizes its error', async () => {
      const { adapter, process } = create();
      process.initializeError = new Error('/private/checkpoints are missing');
      await expect(adapter.initialize()).rejects.toMatchObject({ code: 'INITIALIZATION_FAILED' });
      expect(await adapter.getStatus()).toEqual({
        state: 'unavailable',
        detail: 'Engine initialization failed.',
      });
    });

    it('does not fake request cancellation and disposes idempotently', async () => {
      const { adapter, process } = create();
      await adapter.initialize();
      expect(await adapter.cancel('request-001')).toBe('unsupported');
      expect((await adapter.getCapabilities()).supportsCancellation).toBe(false);
      await adapter.dispose();
      await adapter.dispose();
      expect(process.disposeCalls).toBe(1);
      expect(await adapter.getStatus()).toEqual({ state: 'disposed' });
    });
  });
}

function createIndexFixture() {
  const process = new FakeEngineProcess<IndexTts2ProcessInitialize, IndexTts2ProcessSynthesis>();
  const artifacts = new FakeArtifactStore();
  const profiles = new HostTtsProfileRegistry([{
    id: 'xiazhou-default',
    engine: 'indextts2',
    referenceAudioPath: '/host/profiles/xiazhou/reference.wav',
    emotion: { mode: 'reference-audio', referenceAudioPath: '/host/profiles/xiazhou/calm.wav', weight: 0.7 },
  }]);
  const adapter = new IndexTTS2Adapter({
    modelDirectory: '/host/models/indextts2',
    configPath: '/host/models/indextts2/config.yaml',
    auxModelPaths: { semantic: '/host/models/indextts2/semantic' },
  }, profiles, process, artifacts);
  return { adapter, process, artifacts };
}

function createGptFixture() {
  const process = new FakeEngineProcess<GptSoVitsProcessInitialize, GptSoVitsProcessSynthesis>();
  const artifacts = new FakeArtifactStore();
  const profiles = new HostTtsProfileRegistry([{
    id: 'xiazhou-default',
    engine: 'gpt-sovits',
    referenceAudioPath: '/host/profiles/xiazhou/reference.wav',
    promptText: '这是参考音频的转录。',
    promptLanguage: 'zh',
    gptCheckpointPath: '/host/models/xiazhou/gpt.ckpt',
    sovitsCheckpointPath: '/host/models/xiazhou/sovits.pth',
  }]);
  const adapter = new GPTSoVITSAdapter({
    runtimeConfigPath: '/host/config/gpt-sovits.yaml',
  }, profiles, process, artifacts);
  return { adapter, process, artifacts };
}

runSharedConformance('IndexTTS2Adapter', () => createIndexFixture() as {
  adapter: TtsEngineAdapter;
  process: FakeEngineProcess<unknown, unknown>;
  artifacts: FakeArtifactStore;
});
runSharedConformance('GPTSoVITSAdapter', () => createGptFixture() as {
  adapter: TtsEngineAdapter;
  process: FakeEngineProcess<unknown, unknown>;
  artifacts: FakeArtifactStore;
});

describe('IndexTTS2Adapter mapping and capabilities', () => {
  it('maps generic style to verified non-streaming IndexTTS2 inputs', async () => {
    const { adapter, process } = createIndexFixture();
    await adapter.initialize();
    await adapter.synthesize(genericRequest());
    expect(process.initializeCalls[0]).toMatchObject({ allowDownloads: false });
    expect(process.synthesisCalls[0]).toEqual({
      requestId: 'request-001',
      text: '你好。',
      speakerReferenceAudioPath: '/host/profiles/xiazhou/reference.wav',
      language: 'zh',
      streamReturn: false,
      emotionText: 'calm',
    });
    expect(await adapter.getCapabilities()).toMatchObject({
      supportsStreaming: false,
      supportsEmotion: true,
      supportsPromptTranscript: false,
      supportsRemoteService: false,
    });
  });

  it('validates pre-resolved model config', async () => {
    const { process, artifacts } = createIndexFixture();
    const wrongProfiles = new HostTtsProfileRegistry([{
      id: 'xiazhou-default',
      engine: 'gpt-sovits',
      referenceAudioPath: '/host/reference.wav',
      promptText: 'prompt',
      promptLanguage: 'zh',
      gptCheckpointPath: '/host/gpt.ckpt',
      sovitsCheckpointPath: '/host/sovits.pth',
    }]);
    const adapter = new IndexTTS2Adapter({
      modelDirectory: '',
      configPath: '/host/config.yaml',
      auxModelPaths: {},
    }, wrongProfiles, process, artifacts);
    await expect(adapter.initialize()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('resolves profiles only inside the matching engine namespace', async () => {
    const { process, artifacts } = createIndexFixture();
    const wrongProfiles = new HostTtsProfileRegistry([{
      id: 'xiazhou-default',
      engine: 'gpt-sovits',
      referenceAudioPath: '/host/reference.wav',
      promptText: 'prompt',
      promptLanguage: 'zh',
      gptCheckpointPath: '/host/gpt.ckpt',
      sovitsCheckpointPath: '/host/sovits.pth',
    }]);
    const adapter = new IndexTTS2Adapter({
      modelDirectory: '/host/models/indextts2',
      configPath: '/host/models/indextts2/config.yaml',
      auxModelPaths: { semantic: '/host/models/indextts2/semantic' },
    }, wrongProfiles, process, artifacts);
    await adapter.initialize();
    await expect(adapter.synthesize(genericRequest())).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
      requestId: 'request-001',
    });
  });
});

describe('GPTSoVITSAdapter mapping and capabilities', () => {
  it('maps paired checkpoints and prompt transcript inside the host boundary', async () => {
    const { adapter, process } = createGptFixture();
    await adapter.initialize();
    await adapter.synthesize(genericRequest());
    expect(process.initializeCalls[0]).toMatchObject({ allowDownloads: false });
    expect(process.synthesisCalls[0]).toEqual({
      requestId: 'request-001',
      text: '你好。',
      textLanguage: 'zh',
      referenceAudioPath: '/host/profiles/xiazhou/reference.wav',
      promptText: '这是参考音频的转录。',
      promptLanguage: 'zh',
      gptCheckpointPath: '/host/models/xiazhou/gpt.ckpt',
      sovitsCheckpointPath: '/host/models/xiazhou/sovits.pth',
      streamingMode: false,
      returnFragment: false,
    });
    expect(await adapter.getCapabilities()).toMatchObject({
      supportsStreaming: false,
      supportsEmotion: false,
      supportsPromptTranscript: true,
      supportsRemoteService: false,
    });
  });

  it('rejects incomplete paired checkpoint profiles', async () => {
    const process = new FakeEngineProcess<GptSoVitsProcessInitialize, GptSoVitsProcessSynthesis>();
    const artifacts = new FakeArtifactStore();
    const profiles = new HostTtsProfileRegistry([{
      id: 'xiazhou-default',
      engine: 'gpt-sovits',
      referenceAudioPath: '/host/reference.wav',
      promptText: 'prompt',
      promptLanguage: 'zh',
      gptCheckpointPath: '/host/gpt.ckpt',
      sovitsCheckpointPath: '',
    }]);
    const adapter = new GPTSoVITSAdapter({ runtimeConfigPath: '/host/config.yaml' }, profiles, process, artifacts);
    await adapter.initialize();
    await expect(adapter.synthesize(genericRequest())).rejects.toBeInstanceOf(TtsAdapterError);
  });
});
