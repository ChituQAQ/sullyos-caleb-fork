import type { TtsEngineAdapterId } from './contracts';

interface BaseHostTtsProfile {
  id: string;
  engine: TtsEngineAdapterId;
}

export interface IndexTts2HostProfile extends BaseHostTtsProfile {
  engine: 'indextts2';
  referenceAudioPath: string;
  emotion?:
    | { mode: 'reference-audio'; referenceAudioPath: string; weight?: number }
    | { mode: 'vector'; values: readonly number[]; weight?: number }
    | { mode: 'text'; instruction?: string; weight?: number };
}

export interface GptSoVitsHostProfile extends BaseHostTtsProfile {
  engine: 'gpt-sovits';
  referenceAudioPath: string;
  promptText: string;
  promptLanguage: string;
  gptCheckpointPath: string;
  sovitsCheckpointPath: string;
}

export type HostTtsProfile = IndexTts2HostProfile | GptSoVitsHostProfile;

export class HostTtsProfileRegistry {
  private readonly profiles = new Map<string, HostTtsProfile>();

  constructor(profiles: readonly HostTtsProfile[]) {
    for (const profile of profiles) {
      const key = this.key(profile.engine, profile.id);
      if (this.profiles.has(key)) {
        throw new Error(`Duplicate host TTS profile id for ${profile.engine}`);
      }
      this.profiles.set(key, profile);
    }
  }

  resolveIndexTts2(profileId: string): IndexTts2HostProfile | null {
    const profile = this.profiles.get(this.key('indextts2', profileId));
    return profile?.engine === 'indextts2' ? profile : null;
  }

  resolveGptSoVits(profileId: string): GptSoVitsHostProfile | null {
    const profile = this.profiles.get(this.key('gpt-sovits', profileId));
    return profile?.engine === 'gpt-sovits' ? profile : null;
  }

  private key(engine: TtsEngineAdapterId, profileId: string): string {
    return `${engine}\u0000${profileId}`;
  }
}
