import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { resolveAgentVoiceProfile } from '../lib/agentVoices';
import { voicePlayer } from '../lib/voicePlayer';
import type { Agent } from '../types/village';

interface LiveVoiceCallPanelProps {
  agent: Agent;
  bearerToken?: string | null;
  onEndCall: () => void;
  onTurnCommitted?: (userTranscript: string, agentTranscript: string) => void;
  onAgentSpeechBubble?: (text: string) => void;
}

function downsampleFloat32(
  buffer: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (inputSampleRate === targetSampleRate) return buffer;
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function float32ToPcm16Base64(samples: Float32Array): string {
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = window.atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const LiveVoiceCallPanel: React.FC<LiveVoiceCallPanelProps> = ({
  agent,
  bearerToken,
  onEndCall,
  onTurnCommitted,
  onAgentSpeechBubble,
}) => {
  const profile = resolveAgentVoiceProfile(agent);

  const [callState, setCallState] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveUserCaption, setLiveUserCaption] = useState('');
  const [liveAgentCaption, setLiveAgentCaption] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);
  const isReadyRef = useRef<boolean>(false);

  const userTurnBufferRef = useRef<string>('');
  const agentTurnBufferRef = useRef<string>('');
  const onTurnCommittedRef = useRef(onTurnCommitted);
  const onAgentSpeechBubbleRef = useRef(onAgentSpeechBubble);

  useEffect(() => {
    onTurnCommittedRef.current = onTurnCommitted;
    onAgentSpeechBubbleRef.current = onAgentSpeechBubble;
  }, [onTurnCommitted, onAgentSpeechBubble]);

  const stopQueuedPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAgentSpeaking(false);
  }, []);

  const scheduleOutputAudioChunk = useCallback((base64Audio: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;
    if (outCtx.state === 'suspended') {
      void outCtx.resume();
    }

    const floatSamples = base64Pcm16ToFloat32(base64Audio);
    if (floatSamples.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, floatSamples.length, 24000);
    audioBuffer.getChannelData(0).set(floatSamples);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const startTime = Math.max(outCtx.currentTime + 0.02, nextStartTimeRef.current);
    nextStartTimeRef.current = startTime + audioBuffer.duration;
    activeSourcesRef.current.add(source);
    setIsAgentSpeaking(true);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setIsAgentSpeaking(false);
      }
    };

    source.start(startTime);
  }, []);

  const cleanupSession = useCallback(() => {
    isReadyRef.current = false;
    stopQueuedPlayback();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore close errors
      }
      wsRef.current = null;
    }
  }, [stopQueuedPlayback]);

  useEffect(() => {
    voicePlayer.stop();
    let cancelled = false;

    const startCall = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        mediaStreamRef.current = stream;

        const inputCtx = new AudioContext({ sampleRate: 16000 });
        const outputCtx = new AudioContext({ sampleRate: 24000 });
        inputCtxRef.current = inputCtx;
        outputCtxRef.current = outputCtx;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live-voice`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          ws.send(
            JSON.stringify({
              type: 'init',
              bearerToken: bearerToken ?? undefined,
              agent: {
                id: agent.id,
                name: agent.name,
                role: agent.role,
                title: agent.title,
                department: agent.department,
                buildingId: agent.buildingId,
                modelName: agent.modelName,
                voiceName: agent.voiceName,
                instructions: agent.instructions,
                notes: agent.notes,
              },
            })
          );
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          let msg: {
            type?: string;
            audio?: string;
            text?: string;
            error?: string;
          };
          try {
            msg = JSON.parse(event.data as string);
          } catch {
            return;
          }

          if (msg.type === 'ready') {
            isReadyRef.current = true;
            setCallState('live');

            const micSource = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            const silentGain = inputCtx.createGain();
            silentGain.gain.value = 0;

            processor.onaudioprocess = (audioEvent) => {
              if (!isReadyRef.current || isMutedRef.current) return;
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
              const rawChannel = audioEvent.inputBuffer.getChannelData(0);
              const pcm16k = downsampleFloat32(rawChannel, inputCtx.sampleRate, 16000);
              const base64Audio = float32ToPcm16Base64(pcm16k);
              wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
            };

            micSource.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
            processorRef.current = processor;
          } else if (msg.type === 'audio' && msg.audio) {
            scheduleOutputAudioChunk(msg.audio);
          } else if (msg.type === 'inputTranscript' && msg.text) {
            userTurnBufferRef.current += msg.text;
            setLiveUserCaption(userTurnBufferRef.current.trim());
          } else if (msg.type === 'outputTranscript' && msg.text) {
            agentTurnBufferRef.current += msg.text;
            const cleanText = agentTurnBufferRef.current.trim();
            setLiveAgentCaption(cleanText);
            onAgentSpeechBubbleRef.current?.(cleanText);
          } else if (msg.type === 'interrupted') {
            stopQueuedPlayback();
          } else if (msg.type === 'turnComplete') {
            const finalUser = userTurnBufferRef.current.trim();
            const finalAgent = agentTurnBufferRef.current.trim();
            if (finalUser || finalAgent) {
              onTurnCommittedRef.current?.(finalUser, finalAgent);
            }
            userTurnBufferRef.current = '';
            agentTurnBufferRef.current = '';
          } else if (msg.type === 'error') {
            setCallState('error');
            setErrorMessage(msg.error || 'Live voice connection failed.');
          }
        };

        ws.onerror = () => {
          if (!cancelled) {
            setCallState('error');
            setErrorMessage('Live voice connection interrupted.');
          }
        };

        ws.onclose = () => {
          if (!cancelled && isReadyRef.current) {
            isReadyRef.current = false;
          }
        };
      } catch (err) {
        if (cancelled) return;
        setCallState('error');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Microphone permission is required for live voice conversations.'
        );
      }
    };

    void startCall();

    return () => {
      cancelled = true;
      const pendingUser = userTurnBufferRef.current.trim();
      const pendingAgent = agentTurnBufferRef.current.trim();
      if (pendingUser || pendingAgent) {
        onTurnCommittedRef.current?.(pendingUser, pendingAgent);
        userTurnBufferRef.current = '';
        agentTurnBufferRef.current = '';
      }
      cleanupSession();
    };
  }, [agent, bearerToken, cleanupSession, scheduleOutputAudioChunk, stopQueuedPlayback]);

  useEffect(() => {
    if (callState !== 'live') return;
    const interval = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [callState]);

  const toggleMute = () => {
    const next = !isMuted;
    isMutedRef.current = next;
    setIsMuted(next);
  };

  return (
    <div className="border-b border-slate-800 bg-slate-950/90 px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            {callState === 'connecting' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                <span>Connecting Live Voice...</span>
              </>
            ) : callState === 'error' ? (
              <span className="text-rose-300">Voice Call Unavailable</span>
            ) : isAgentSpeaking ? (
              <>
                <Volume2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-amber-300">{agent.name} is speaking</span>
              </>
            ) : isMuted ? (
              <>
                <MicOff className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-300">Microphone muted</span>
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-emerald-300">Listening · Speak naturally</span>
              </>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400 truncate tabular-nums">
            {profile.timbreLabel} · Live Voice · {formatDuration(elapsedSeconds)}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {callState === 'live' && (
            <button
              type="button"
              onClick={toggleMute}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isMuted
                  ? 'border-amber-500/50 bg-amber-950/50 text-amber-200'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              <span>{isMuted ? 'Unmute' : 'Mute'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              cleanupSession();
              onEndCall();
            }}
            className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            <span>End Call</span>
          </button>
        </div>
      </div>

      {errorMessage ? (
        <p className="text-xs text-rose-300 leading-relaxed">{errorMessage}</p>
      ) : (
        (liveUserCaption || liveAgentCaption) && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 space-y-1 text-xs leading-relaxed">
            {liveUserCaption && (
              <p className="text-slate-300">
                <span className="font-semibold text-amber-400">You: </span>
                {liveUserCaption}
              </p>
            )}
            {liveAgentCaption && (
              <p className="text-slate-100">
                <span className="font-semibold text-sky-300">{agent.name}: </span>
                {liveAgentCaption}
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
};
