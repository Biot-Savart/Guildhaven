import React from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import { useVoicePlayer, voicePlayer, type VoiceTurnInput } from '../lib/voicePlayer';

interface SpeakButtonProps {
  itemId: string;
  turn?: Omit<VoiceTurnInput, 'itemId'>;
  dialogueTurns?: VoiceTurnInput[];
  label?: string;
  playingLabel?: string;
  variant?: 'subtle' | 'secondary' | 'inline';
}

export const SpeakButton: React.FC<SpeakButtonProps> = ({
  itemId,
  turn,
  dialogueTurns,
  label = 'Listen',
  playingLabel = 'Stop',
  variant = 'subtle',
}) => {
  const player = useVoicePlayer();
  const isActive =
    player.activeItemId === itemId ||
    (player.activeSubItemId != null && player.activeSubItemId === itemId);
  const isLoading = isActive && player.status === 'loading';
  const isPlaying = isActive && player.status === 'playing';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dialogueTurns && dialogueTurns.length > 0) {
      void voicePlayer.toggleConversation({
        itemId,
        turns: dialogueTurns,
      });
      return;
    }
    if (turn) {
      void voicePlayer.toggleSingle({
        ...turn,
        itemId,
      });
    }
  };

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          isActive ? 'text-amber-300 hover:text-amber-200' : 'text-slate-400 hover:text-white'
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
            <span>Loading...</span>
          </>
        ) : isPlaying ? (
          <>
            <Square className="h-2.5 w-2.5 fill-current text-amber-400" />
            <span>{playingLabel}</span>
          </>
        ) : (
          <>
            <Volume2 className="h-3 w-3" />
            <span>{label}</span>
          </>
        )}
      </button>
    );
  }

  if (variant === 'secondary') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          isActive
            ? 'border-amber-500/70 bg-amber-950/60 text-amber-200 hover:bg-amber-950'
            : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-amber-500/60 hover:text-white'
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
            <span>Loading...</span>
          </>
        ) : isPlaying ? (
          <>
            <Square className="h-3 w-3 fill-current text-amber-400" />
            <span>{playingLabel}</span>
          </>
        ) : (
          <>
            <Volume2 className="h-3.5 w-3.5 text-amber-400" />
            <span>{label}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
        isActive
          ? 'border-amber-500/60 bg-amber-950/60 text-amber-200 hover:bg-amber-950'
          : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:text-white'
      }`}
    >
      {isLoading ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
          <span>Loading...</span>
        </>
      ) : isPlaying ? (
        <>
          <Square className="h-2.5 w-2.5 fill-current text-amber-400" />
          <span>{playingLabel}</span>
        </>
      ) : (
        <>
          <Volume2 className="h-3 w-3 text-amber-400" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
