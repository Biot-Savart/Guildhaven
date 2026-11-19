import React, { useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  Send,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import townHallImg from '../assets/images/town_hall_conference_1794560538457.jpg';
import officeImg from '../assets/images/office_interior_studio_1794560537708.jpg';
import { pickVoiceForCustomAgent, resolveAgentVoiceProfile } from '../lib/agentVoices';
import { useVoicePlayer } from '../lib/voicePlayer';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';
import { FormattedMarkdown } from './FormattedMarkdown';
import { SpeakButton } from './SpeakButton';
import type {
  Agent,
  Building,
  HiringCandidate,
  KnowledgeEntry,
  TownHallMode,
} from '../types/village';

interface TownHallEntry {
  speakerId: string;
  speakerName: string;
  speakerTitle: string;
  message: string;
}

interface BuildingInteriorModalProps {
  building: Building;
  agents: Agent[];
  knowledgeEntries: KnowledgeEntry[];
  onOpenKnowledgeBase: (department?: string) => void;
  onOpenWorkspace?: () => void;
  onClose: () => void;
  onOpenAgentChat: (agent: Agent) => void;
  onRunTownHall: (
    mode: TownHallMode,
    prompt: string,
    targetDirectorId?: string | null
  ) => Promise<TownHallEntry[]>;
  onProposeHire: (directorId: string) => Promise<HiringCandidate>;
  onInterviewCandidate: (candidate: HiringCandidate, question: string) => Promise<string>;
  onApproveHire: (candidate: HiringCandidate) => void;
}

export const BuildingInteriorModal: React.FC<BuildingInteriorModalProps> = ({
  building,
  agents,
  knowledgeEntries,
  onOpenKnowledgeBase,
  onOpenWorkspace,
  onClose,
  onOpenAgentChat,
  onRunTownHall,
  onProposeHire,
  onInterviewCandidate,
  onApproveHire,
}) => {
  const isTownHall = building.id === 'town_hall';
  const directors = agents.filter((a) => a.role === 'director');
  const buildingAgents = agents.filter((a) => a.buildingId === building.id && a.id !== 'cho');
  const houseKnowledge = knowledgeEntries.filter(
    (k) => k.department === building.name || k.department === 'All Houses'
  );
  const player = useVoicePlayer();

  const [mode, setMode] = useState<TownHallMode>('general');
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [townHallPrompt, setTownHallPrompt] = useState('');
  const [townHallFeed, setTownHallFeed] = useState<TownHallEntry[]>([
    {
      speakerId: 'matt',
      speakerName: 'Matt',
      speakerTitle: 'Chief of Staff',
      message:
        'All eight Directors are seated at the table. Ask the whole room anything, choose a Briefing preset, or click a Director’s chair to address them directly.',
    },
  ]);
  const [isTownHallBusy, setIsTownHallBusy] = useState(false);

  // Hiring state
  const [hireDirectorId, setHireDirectorId] = useState<string>(directors[0]?.id ?? 'aria');
  const [candidate, setCandidate] = useState<HiringCandidate | null>(null);
  const [isProposing, setIsProposing] = useState(false);
  const [interviewLog, setInterviewLog] = useState<Array<{ who: string; text: string }>>([]);
  const [interviewInput, setInterviewInput] = useState('');
  const [isInterviewing, setIsInterviewing] = useState(false);
  const [hiredBanner, setHiredBanner] = useState<string | null>(null);

  const handleRunMeeting = async (customPrompt?: string, customMode?: TownHallMode) => {
    const activeMode = customMode ?? mode;
    const text =
      customPrompt ??
      (townHallPrompt.trim() ||
        (activeMode === 'morning_briefing'
          ? 'Give me today’s Morning Briefing: priorities, inbox/calendar overview, and blockers.'
          : activeMode === 'daily_debrief'
            ? 'Give me our Daily Debrief: what did your teams finish today and what needs my approval?'
            : activeMode === 'quarterly_review'
              ? 'Let’s hold our Quarterly Review: biggest wins, bottlenecks, and where we should hire.'
              : 'What is everyone working on right now?'));
    if (!customPrompt) setTownHallPrompt('');
    setIsTownHallBusy(true);
    try {
      const entries = await onRunTownHall(activeMode, text, selectedSeatId);
      setTownHallFeed((prev) => [
        ...prev,
        {
          speakerId: 'cho',
          speakerName: 'You (CHO)',
          speakerTitle: selectedSeatId
            ? `To ${directors.find((d) => d.id === selectedSeatId)?.name ?? 'Director'}`
            : 'To Everyone',
          message: text,
        },
        ...entries,
      ]);
    } finally {
      setIsTownHallBusy(false);
    }
  };

  const handleFindCandidate = async (targetDirId: string) => {
    setIsProposing(true);
    setHiredBanner(null);
    setInterviewLog([]);
    try {
      const cand = await onProposeHire(targetDirId);
      setCandidate(cand);
      setInterviewLog([
        {
          who: 'Matt',
          text: `I recruited ${cand.name} (${cand.specialty}) for ${cand.directorName}. ${cand.rationale} Ask them anything before deciding.`,
        },
      ]);
    } finally {
      setIsProposing(false);
    }
  };

  const handleAskCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidate || !interviewInput.trim() || isInterviewing) return;
    const q = interviewInput.trim();
    setInterviewInput('');
    setInterviewLog((prev) => [...prev, { who: 'You (CHO)', text: q }]);
    setIsInterviewing(true);
    try {
      const ans = await onInterviewCandidate(candidate, q);
      setInterviewLog((prev) => [...prev, { who: candidate.name, text: ans }]);
    } finally {
      setIsInterviewing(false);
    }
  };

  const handleConfirmHire = () => {
    if (!candidate) return;
    onApproveHire(candidate);
    setHiredBanner(
      `${candidate.name} welcomed to the village and assigned to ${candidate.directorName}'s guild house!`
    );
    setCandidate(null);
  };

  // Seat coordinates over the 16:9 Town Hall conference table artwork
  const tableSeats = [
    { id: 'cho', label: 'You (CHO)', x: '18%', y: '72%' },
    { id: 'matt', label: 'Matt', x: '82%', y: '34%' },
    { id: 'kieran', label: 'Kieran', x: '25%', y: '56%' },
    { id: 'daniel', label: 'Daniel', x: '34%', y: '44%' },
    { id: 'aria', label: 'Aria', x: '46%', y: '38%' },
    { id: 'elena', label: 'Elena', x: '60%', y: '33%' },
    { id: 'marcus', label: 'Marcus', x: '72%', y: '30%' },
    { id: 'devon', label: 'Devon', x: '38%', y: '69%' },
    { id: 'layla', label: 'Layla', x: '53%', y: '62%' },
    { id: 'noah', label: 'Noah', x: '67%', y: '54%' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{building.name}</h2>
            <p className="text-xs text-slate-400 truncate">{building.interiorSubtitle}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {building.id === 'inbox' && onOpenWorkspace && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenWorkspace();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Unified Workspace Hub</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              <X className="h-4 w-4" />
              <span>Exit to Village</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden">
          {/* Left Stage: Interior Scene with Seated / Working Agents */}
          <div className="lg:col-span-6 relative min-h-[300px] bg-slate-950 flex flex-col">
            <div className="relative flex-1 overflow-hidden">
              <img
                src={isTownHall ? townHallImg : officeImg}
                alt={building.name}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-transparent to-slate-950/30" />

              {isTownHall ? (
                <>
                  {tableSeats.map((seat) => {
                    const agent = agents.find((a) => a.id === seat.id);
                    const isSpeakingSeat =
                      player.status === 'playing' && player.agentId === seat.id;
                    const isSelected = selectedSeatId === seat.id || isSpeakingSeat;
                    const isDirector = agent?.role === 'director';
                    return (
                      <button
                        key={seat.id}
                        onClick={() => {
                          if (isDirector) {
                            setSelectedSeatId(selectedSeatId === seat.id ? null : seat.id);
                          }
                        }}
                        style={{ left: seat.x, top: seat.y }}
                        className={`-translate-x-1/2 -translate-y-1/2 absolute flex flex-col items-center transition-transform hover:scale-105 ${
                          isDirector ? 'cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        {agent && (
                          <CharacterSpriteBadge agent={agent} size={48} selected={isSelected} />
                        )}
                        <span
                          className={`-mt-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            isSpeakingSeat
                              ? 'bg-emerald-400 text-slate-950'
                              : selectedSeatId === seat.id
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-950/85 text-slate-100'
                          }`}
                        >
                          {isSpeakingSeat ? `${seat.label} · Speaking` : seat.label}
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-3">
                  {buildingAgents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        onClose();
                        onOpenAgentChat(a);
                      }}
                      className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-left hover:border-amber-400 transition-colors cursor-pointer"
                    >
                      <CharacterSpriteBadge agent={a} size={44} />
                      <div>
                        <p className="text-xs font-semibold text-white">{a.name}</p>
                        <p className="text-[11px] text-slate-400">{a.title}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Town Hall Meetings / Hiring OR Director Office Controls */}
          <div className="lg:col-span-6 flex flex-col border-t lg:border-t-0 lg:border-l border-slate-800 overflow-hidden bg-slate-900">
            {isTownHall ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-4 py-2.5 bg-slate-950/50">
                  {(
                    [
                      ['general', 'All-Hands'],
                      ['morning_briefing', 'Morning Briefing'],
                      ['daily_debrief', 'Daily Debrief'],
                      ['quarterly_review', 'Quarterly Review'],
                      ['hiring_interview', 'Hire Worker'],
                    ] as Array<[TownHallMode, string]>
                  ).map(([mId, label]) => (
                    <button
                      key={mId}
                      onClick={() => {
                        setMode(mId);
                        if (mId !== 'hiring_interview' && mId !== 'general') {
                          void handleRunMeeting(undefined, mId);
                        }
                      }}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        mode === mId
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === 'hiring_interview' ? (
                  <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={hireDirectorId}
                        onChange={(e) => setHireDirectorId(e.target.value)}
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                      >
                        {directors.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.department})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleFindCandidate(hireDirectorId)}
                        disabled={isProposing}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>{isProposing ? 'Recruiting...' : 'Find Candidate'}</span>
                      </button>
                    </div>

                    {hiredBanner && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/50 p-3 text-xs text-emerald-200">
                        {hiredBanner}
                      </div>
                    )}

                    {candidate ? (
                      <>
                        <div className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 shrink-0 overflow-hidden">
                            <CharacterSpriteBadge
                              agent={{
                                id: candidate.id,
                                name: candidate.name,
                                role: 'worker',
                                title: candidate.specialty,
                                department:
                                  directors.find((d) => d.id === candidate.directorId)?.department ??
                                  'Village',
                                buildingId: candidate.buildingId,
                                modelName: 'gemini-3.1-flash-lite',
                                advisorEnabled: false,
                                instructions: '',
                                notes: [],
                                shirtColor: candidate.shirtColor,
                                pantsColor: '#292524',
                                hairColor: candidate.hairColor,
                                skinColor: '#FED7AA',
                                hasYellowVest: false,
                                x: 0,
                                y: 0,
                                direction: 'down',
                                walkFrame: 0,
                                isMoving: false,
                                state: 'idle_yard',
                                speechBubble: null,
                                speechTimer: 0,
                                path: [],
                                talkedTodayWith: [],
                                activeTaskId: null,
                                patrolTimer: 0,
                              }}
                              size={46}
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-white">
                                {candidate.name} · {candidate.specialty}
                              </p>
                              <span className="text-[11px] text-amber-400 font-medium">
                                Guild Specialist Candidate
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">{candidate.bio}</p>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                          {interviewLog.map((item, i) => {
                            const isCho = item.who === 'You (CHO)';
                            const isMatt = item.who === 'Matt';
                            const parentDirector = directors.find(
                              (d) => d.id === candidate.directorId
                            );
                            const candidateVoice = pickVoiceForCustomAgent(
                              candidate.name,
                              parentDirector?.voiceName
                            );
                            return (
                              <div
                                key={i}
                                className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs text-slate-200 space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-amber-400">{item.who}</span>
                                  {!isCho && (
                                    <SpeakButton
                                      variant="inline"
                                      itemId={`cand_log_${candidate.id}_${i}`}
                                      label="Listen"
                                      turn={{
                                        agentId: isMatt ? 'matt' : candidate.id,
                                        speakerName: item.who,
                                        title: isMatt ? 'Chief of Staff' : candidate.specialty,
                                        voiceName: isMatt
                                          ? agents.find((a) => a.id === 'matt')?.voiceName
                                          : candidateVoice,
                                        text: item.text,
                                      }}
                                    />
                                  )}
                                </div>
                                <p className="leading-relaxed">{item.text}</p>
                              </div>
                            );
                          })}
                          {isInterviewing && (
                            <p className="text-xs text-slate-400 italic">Candidate is answering...</p>
                          )}
                        </div>

                        <form onSubmit={handleAskCandidate} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={interviewInput}
                            onChange={(e) => setInterviewInput(e.target.value)}
                            placeholder="Interview question for candidate..."
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isInterviewing || !interviewInput.trim()}
                            className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 cursor-pointer"
                          >
                            Ask
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmHire}
                            className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Approve Hire
                          </button>
                        </form>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center p-6 text-xs text-slate-400">
                        Select a department and click “Find Candidate” so Matt can invite a new Guild Specialist candidate into Town Hall for your interview.
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-800 text-xs text-slate-400">
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        <Users className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">
                          {selectedSeatId
                            ? `Addressing: ${directors.find((d) => d.id === selectedSeatId)?.name}`
                            : `Addressing: All ${directors.length} Directors`}
                        </span>
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {selectedSeatId && (
                          <button
                            onClick={() => setSelectedSeatId(null)}
                            className="text-amber-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Address Everyone
                          </button>
                        )}
                        <SpeakButton
                          variant="subtle"
                          itemId={`th_all_${townHallFeed.length}`}
                          label="Listen All"
                          dialogueTurns={townHallFeed
                            .filter((en) => en.speakerId !== 'cho')
                            .map((en, idx) => {
                              const found = agents.find(
                                (a) => a.id === en.speakerId || a.name === en.speakerName
                              );
                              return {
                                itemId: `th_entry_${idx}`,
                                agentId: found?.id ?? en.speakerId,
                                speakerName: en.speakerName,
                                title: en.speakerTitle,
                                department: found?.department,
                                voiceName: found?.voiceName,
                                text: en.message,
                              };
                            })}
                        />
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {townHallFeed.map((entry, idx) => {
                        const foundSpeaker = agents.find(
                          (a) => a.id === entry.speakerId || a.name === entry.speakerName
                        );
                        return (
                          <div
                            key={idx}
                            className={`rounded-lg border p-3 text-xs leading-relaxed ${
                              entry.speakerId === 'cho'
                                ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                                : 'border-slate-800 bg-slate-950/70 text-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="font-semibold text-white truncate">
                                {entry.speakerName}{' '}
                                <span className="font-normal text-slate-400">· {entry.speakerTitle}</span>
                              </p>
                              {entry.speakerId !== 'cho' && (
                                <SpeakButton
                                  variant="inline"
                                  itemId={`th_entry_${idx}`}
                                  label="Listen"
                                  turn={{
                                    agentId: foundSpeaker?.id ?? entry.speakerId,
                                    speakerName: entry.speakerName,
                                    title: entry.speakerTitle,
                                    department: foundSpeaker?.department,
                                    voiceName: foundSpeaker?.voiceName,
                                    text: entry.message,
                                  }}
                                />
                              )}
                            </div>
                            {entry.speakerId === 'cho' ? (
                              <p className="whitespace-pre-wrap">{entry.message}</p>
                            ) : (
                              <FormattedMarkdown compact content={entry.message} />
                            )}
                          </div>
                        );
                      })}
                      {isTownHallBusy && (
                        <p className="text-xs text-slate-400 italic">
                          Directors are conferring around the table...
                        </p>
                      )}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleRunMeeting();
                      }}
                      className="flex items-center gap-2 border-t border-slate-800 p-3"
                    >
                      <input
                        type="text"
                        value={townHallPrompt}
                        onChange={(e) => setTownHallPrompt(e.target.value)}
                        placeholder={
                          selectedSeatId
                            ? `Ask ${directors.find((d) => d.id === selectedSeatId)?.name} in front of the council...`
                            : 'Address all directors in Town Hall...'
                        }
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isTownHallBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Speak</span>
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              /* Director House Interior Panel */
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-white">Department Roster</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Click any character inside the office or below to open their direct chat and folder notes.
                  </p>
                  <div className="mt-3 space-y-2">
                    {buildingAgents.map((a) => {
                      const voiceProfile = resolveAgentVoiceProfile(a);
                      return (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3.5 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">
                              {a.name} · <span className="text-slate-400 font-normal">{a.title}</span>
                            </p>
                            <p className="text-[11px] text-amber-300/90 mt-0.5 truncate">
                              Busy with: {a.currentActivity || `Standing by for your direction · ${a.department}`}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                              {voiceProfile.timbreLabel}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <SpeakButton
                              variant="subtle"
                              itemId={`office_preview_${a.id}`}
                              label="Voice"
                              turn={{
                                agentId: a.id,
                                speakerName: a.name,
                                title: a.title,
                                department: a.department,
                                voiceName: a.voiceName,
                                text: voiceProfile.sampleLine,
                              }}
                            />
                            <button
                              onClick={() => {
                                onClose();
                                onOpenAgentChat(a);
                              }}
                              className="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 hover:text-slate-950 transition-colors cursor-pointer shrink-0"
                            >
                              Talk
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Centralized Knowledge Base Ground Truth for This Guild House */}
                <div className="border-t border-slate-800 pt-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
                        <BookOpen className="h-3.5 w-3.5 text-amber-400" />
                        <span>Centralized Knowledge Base</span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {building.id === 'research' || building.id === 'operations'
                          ? 'Co-Led Here by Aria, Zoe & Eli · Single Source of Truth'
                          : `Active ground-truth SOPs & briefs for ${building.name}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenKnowledgeBase(building.name);
                      }}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Open Index
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {houseKnowledge.slice(0, 3).map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                      >
                        <p className="text-[11px] text-slate-400 truncate">
                          <span className="font-mono text-amber-300">{entry.code}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{entry.maintainedBy}</span>
                        </p>
                        <p className="text-xs font-medium text-white truncate mt-0.5">
                          {entry.title}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
