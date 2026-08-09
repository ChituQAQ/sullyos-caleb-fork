import type { EngineAudioOutput } from './contracts';

/**
 * Host-only seam for a controlled Python worker or sidecar.
 *
 * The adapters depend on this interface instead of importing either Python
 * implementation. A production process wrapper remains M2-P1 work.
 */
export interface TtsEngineProcess<TInitialize, TSynthesis> {
  initialize(config: TInitialize): Promise<void>;
  synthesize(request: TSynthesis): Promise<EngineAudioOutput>;
  dispose(): Promise<void>;
}
