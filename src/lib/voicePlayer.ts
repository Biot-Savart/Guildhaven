import { useSyncExternalStore } from 'react';
import { resolveAgentVoiceProfile, stripMarkdownForSpeech } from './agentVoices';
import type { AgentVoiceName } from '../types/village';

export interface VoiceTurnInput {
  itemId?: string;
  agentId?: string;
  speakerName: string;
  title?: string;
  department?: string;
  voiceName?: AgentVoiceName;
  text: string;
  maxChars?: number;
}

export interface VoicePlayerState {
  status: 'idle' | 'loading' | 'playing';
  activeItemId: string | null;
  activeSubItemId: string | null;
  agentId: string | null;
  speakerName: string | null;
  timbreLabel: string | null;
  snippet: string | null;
  queueIndex: number;
  queueTotal: number;
  error: string | null;
  autoSpeakReplies: boolean;
}

const AUTO_SPEAK_STORAGE_KEY = 'gemini_village_auto_speak_v1';

function readInitialAutoSpeak(): boolean {
  try {
    return localStorage.getItem(AUTO_SPEAK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function base64ToBlobUrl(base64: string, mimeType = 'audio/wav'): string {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

class VillageVoicePlayer {
  private state: VoicePlayerState = {
    status: 'idle',
    activeItemId: null,
    activeSubItemId: null,
    agentId: null,
    speakerName: null,
    timbreLabel: null,
    snippet: null,
    queueIndex: 0,
    queueTotal: 0,
    error: null,
    autoSpeakReplies: typeof window !== 'undefined' ? readInitialAutoSpeak() : false,
  };

  private listeners = new Set<() => void>();
  private currentAudio: HTMLAudioElement | null = null;
  private runToken = 0;
  private skipResolver: (() => void) | null = null;
  private blobCache = new Map<string, { url: string; timbreLabel: string }>();
  private onAgentSpeakListeners = new Set<(agentId: string | null, snippet: string) => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onAgentSpeaking(cb: (agentId: string | null, snippet: string) => void): () => void {
    this.onAgentSpeakListeners.add(cb);
    return () => {
      this.onAgentSpeakListeners.delete(cb);
    };
  }

  getSnapshot = (): VoicePlayerState => this.state;

  private setState(patch: Partial<VoicePlayerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private putBlobCache(key: string, value: { url: string; timbreLabel: string }) {
    if (this.blobCache.has(key)) return;
    if (this.blobCache.size >= 32) {
      const oldestKey = this.blobCache.keys().next().value;
      if (oldestKey) {
        const old = this.blobCache.get(oldestKey);
        if (old) URL.revokeObjectURL(old.url);
        this.blobCache.delete(oldestKey);
      }
    }
    this.blobCache.set(key, value);
  }

  setAutoSpeakReplies(enabled: boolean) {
    try {
      localStorage.setItem(AUTO_SPEAK_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore storage failures
    }
    this.setState({ autoSpeakReplies: enabled });
  }

  toggleAutoSpeakReplies() {
    this.setAutoSpeakReplies(!this.state.autoSpeakReplies);
  }

  clearError() {
    if (this.state.error) {
      this.setState({ error: null });
    }
  }

  stop() {
    this.runToken++;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (this.skipResolver) {
      const r = this.skipResolver;
      this.skipResolver = null;
      r();
    }
    this.setState({
      status: 'idle',
      activeItemId: null,
      activeSubItemId: null,
      agentId: null,
      speakerName: null,
      timbreLabel: null,
      snippet: null,
      queueIndex: 0,
      queueTotal: 0,
    });
  }

  skipNext() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (this.skipResolver) {
      const r = this.skipResolver;
      this.skipResolver = null;
      r();
    }
  }

  private async fetchSingleClip(turn: VoiceTurnInput): Promise<{ url: string; timbreLabel: string }> {
    const profile = resolveAgentVoiceProfile({
      id: turn.agentId,
      name: turn.speakerName,
      title: turn.title,
      department: turn.department,
      voiceName: turn.voiceName,
    });
    const spoken = stripMarkdownForSpeech(turn.text, turn.maxChars ?? 2200);
    const cacheKey = `single:${profile.voiceName}:${spoken}`;
    const existing = this.blobCache.get(cacheKey);
    if (existing) return existing;

    const res = await fetch('/api/village/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: turn.agentId,
        speakerName: turn.speakerName,
        title: turn.title,
        department: turn.department,
        voiceName: turn.voiceName,
        text: spoken,
        maxChars: turn.maxChars ?? 2200,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      audioBase64?: string;
      mimeType?: string;
      timbreLabel?: string;
      error?: string;
    };
    if (!res.ok || !data.audioBase64) {
      throw new Error(data.error || 'Unable to synthesize agent voice.');
    }

    const url = base64ToBlobUrl(data.audioBase64, data.mimeType || 'audio/wav');
    const entry = { url, timbreLabel: data.timbreLabel || profile.timbreLabel };
    this.putBlobCache(cacheKey, entry);
    return entry;
  }

  private playUrlUntilEnded(url: string, token: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (token !== this.runToken) {
        resolve();
        return;
      }
      const audio = new Audio(url);
      this.currentAudio = audio;
      this.skipResolver = () => resolve();

      audio.onended = () => {
        if (this.currentAudio === audio) this.currentAudio = null;
        this.skipResolver = null;
        resolve();
      };
      audio.onerror = () => {
        if (this.currentAudio === audio) this.currentAudio = null;
        this.skipResolver = null;
        reject(new Error('Audio playback interrupted or unsupported.'));
      };
      audio.play().catch((err) => {
        if (this.currentAudio === audio) this.currentAudio = null;
        this.skipResolver = null;
        reject(err instanceof Error ? err : new Error('Audio playback blocked by browser.'));
      });
    });
  }

  async toggleSingle(params: VoiceTurnInput & { itemId: string }): Promise<void> {
    if (
      this.state.activeItemId === params.itemId &&
      (this.state.status === 'loading' || this.state.status === 'playing')
    ) {
      this.stop();
      return;
    }
    await this.playSingle(params);
  }

  async playSingle(params: VoiceTurnInput & { itemId: string }): Promise<void> {
    const cleanSnippet = stripMarkdownForSpeech(params.text, 140);
    if (!cleanSnippet) return;

    this.stop();
    const token = ++this.runToken;
    const profile = resolveAgentVoiceProfile({
      id: params.agentId,
      name: params.speakerName,
      title: params.title,
      department: params.department,
      voiceName: params.voiceName,
    });

    this.setState({
      status: 'loading',
      activeItemId: params.itemId,
      activeSubItemId: params.itemId,
      agentId: params.agentId ?? profile.agentId,
      speakerName: profile.speakerName,
      timbreLabel: profile.timbreLabel,
      snippet: cleanSnippet,
      queueIndex: 1,
      queueTotal: 1,
      error: null,
    });

    try {
      const clip = await this.fetchSingleClip(params);
      if (token !== this.runToken) return;

      for (const cb of this.onAgentSpeakListeners) {
        cb(params.agentId ?? profile.agentId, cleanSnippet);
      }

      this.setState({
        status: 'playing',
        timbreLabel: clip.timbreLabel,
      });

      await this.playUrlUntilEnded(clip.url, token);
      if (token === this.runToken) {
        this.stop();
      }
    } catch (err) {
      if (token !== this.runToken) return;
      this.setState({
        status: 'idle',
        activeItemId: null,
        activeSubItemId: null,
        error: err instanceof Error ? err.message : 'Voice playback failed.',
      });
    }
  }

  /**
   * Plays a multi-agent conversation or Town Hall roundtable.
   * Uses native dual-speaker Gemini TTS (gemini-3.8-flash-tts) when 2 villagers converse,
   * or pre-fetched sequential voice playback when 3+ speakers take turns at the table.
   */
  async toggleConversation(params: {
    itemId: string;
    turns: VoiceTurnInput[];
  }): Promise<void> {
    if (
      this.state.activeItemId === params.itemId &&
      (this.state.status === 'loading' || this.state.status === 'playing')
    ) {
      this.stop();
      return;
    }

    const speakableTurns = params.turns.filter(
      (t) =>
        t.speakerName !== 'You (CHO)' &&
        t.agentId !== 'cho' &&
        stripMarkdownForSpeech(t.text, 200).length > 0
    );
    if (speakableTurns.length === 0) return;

    if (speakableTurns.length === 1) {
      await this.playSingle({
        ...speakableTurns[0],
        itemId: params.itemId,
      });
      return;
    }

    const uniqueSpeakers = new Set(
      speakableTurns.map((t) =>
        resolveAgentVoiceProfile({
          id: t.agentId,
          name: t.speakerName,
          voiceName: t.voiceName,
        }).speakerName
      )
    );

    // Native 2-speaker conversational synthesis via gemini-3.8-flash-tts
    if (uniqueSpeakers.size === 2 && speakableTurns.length <= 4) {
      this.stop();
      const token = ++this.runToken;
      const firstProfile = resolveAgentVoiceProfile(speakableTurns[0]);
      const secondTurn = speakableTurns.find(
        (t) => resolveAgentVoiceProfile(t).speakerName !== firstProfile.speakerName
      );
      const secondProfile = secondTurn ? resolveAgentVoiceProfile(secondTurn) : firstProfile;
      const combinedNames = `${firstProfile.speakerName} & ${secondProfile.speakerName}`;
      const combinedVoices = `${firstProfile.voiceName} + ${secondProfile.voiceName}`;
      const previewSnippet = stripMarkdownForSpeech(
        `${firstProfile.speakerName}: "${speakableTurns[0].text}"`,
        140
      );

      this.setState({
        status: 'loading',
        activeItemId: params.itemId,
        activeSubItemId: speakableTurns[0].itemId ?? params.itemId,
        agentId: firstProfile.agentId,
        speakerName: combinedNames,
        timbreLabel: combinedVoices,
        snippet: previewSnippet,
        queueIndex: 1,
        queueTotal: 1,
        error: null,
      });

      try {
        const cacheKey = `dlg:${JSON.stringify(
          speakableTurns.map((t) => ({ s: t.speakerName, v: t.voiceName, x: t.text }))
        )}`;
        let clip = this.blobCache.get(cacheKey);
        if (!clip) {
          const res = await fetch('/api/village/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dialogue: speakableTurns.map((t) => ({
                agentId: t.agentId,
                speakerName: t.speakerName,
                title: t.title,
                department: t.department,
                voiceName: t.voiceName,
                text: t.text,
              })),
            }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            audioBase64?: string;
            mimeType?: string;
            error?: string;
          };
          if (!res.ok || !data.audioBase64) {
            throw new Error(data.error || 'Failed to synthesize dual-speaker conversation.');
          }
          const url = base64ToBlobUrl(data.audioBase64, data.mimeType || 'audio/wav');
          clip = { url, timbreLabel: combinedVoices };
          this.putBlobCache(cacheKey, clip);
        }

        if (token !== this.runToken) return;
        for (const cb of this.onAgentSpeakListeners) {
          cb(firstProfile.agentId, stripMarkdownForSpeech(speakableTurns[0].text, 110));
        }

        this.setState({ status: 'playing' });
        await this.playUrlUntilEnded(clip.url, token);
        if (token === this.runToken) {
          this.stop();
        }
        return;
      } catch {
        if (token !== this.runToken) return;
        // Fall through to sequential per-speaker queue if dual-speaker errors
      }
    }

    // Sequential multi-speaker roundtable queue with lookahead pre-fetching
    this.stop();
    const token = ++this.runToken;
    let nextPrefetch: Promise<{ url: string; timbreLabel: string }> | null =
      this.fetchSingleClip(speakableTurns[0]);

    try {
      for (let i = 0; i < speakableTurns.length; i++) {
        if (token !== this.runToken) return;
        const turn = speakableTurns[i];
        const profile = resolveAgentVoiceProfile(turn);
        const turnSnippet = stripMarkdownForSpeech(turn.text, 140);

        this.setState({
          status: 'loading',
          activeItemId: params.itemId,
          activeSubItemId: turn.itemId ?? `${params.itemId}_${i}`,
          agentId: turn.agentId ?? profile.agentId,
          speakerName: profile.speakerName,
          timbreLabel: profile.timbreLabel,
          snippet: turnSnippet,
          queueIndex: i + 1,
          queueTotal: speakableTurns.length,
          error: null,
        });

        const currentPromise = nextPrefetch ?? this.fetchSingleClip(turn);
        // Kick off background prefetch for turn i + 1 while current turn loads/plays
        nextPrefetch =
          i + 1 < speakableTurns.length
            ? this.fetchSingleClip(speakableTurns[i + 1]).catch(() => null as unknown as { url: string; timbreLabel: string })
            : null;

        const clip = await currentPromise;
        if (!clip || token !== this.runToken) return;

        for (const cb of this.onAgentSpeakListeners) {
          cb(turn.agentId ?? profile.agentId, turnSnippet);
        }

        this.setState({
          status: 'playing',
          timbreLabel: clip.timbreLabel,
        });
        await this.playUrlUntilEnded(clip.url, token);
      }

      if (token === this.runToken) {
        this.stop();
      }
    } catch (err) {
      if (token !== this.runToken) return;
      this.setState({
        status: 'idle',
        activeItemId: null,
        activeSubItemId: null,
        error: err instanceof Error ? err.message : 'Roundtable audio playback failed.',
      });
    }
  }
}

export const voicePlayer = new VillageVoicePlayer();

export function useVoicePlayer(): VoicePlayerState {
  return useSyncExternalStore(voicePlayer.subscribe, voicePlayer.getSnapshot, voicePlayer.getSnapshot);
}
