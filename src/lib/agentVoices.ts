import type { AgentVoiceName } from '../types/village.ts';

export interface VoiceOptionMeta {
  voiceName: AgentVoiceName;
  timbre: string;
  description: string;
}

export const AGENT_VOICE_OPTIONS: VoiceOptionMeta[] = [
  {
    voiceName: 'Zephyr',
    timbre: 'Warm & Articulate',
    description: 'Smooth, reassuring cadence suited for briefings and creative storytelling.',
  },
  {
    voiceName: 'Kore',
    timbre: 'Clear & Expressive',
    description: 'Crisp, poised alto delivery ideal for research syntheses and studio direction.',
  },
  {
    voiceName: 'Charon',
    timbre: 'Calm Baritone',
    description: 'Steady, composed resonance suited for systems architecture and scheduling.',
  },
  {
    voiceName: 'Puck',
    timbre: 'Bright & Upbeat',
    description: 'Energetic, friendly pace suited for couriers, coaching, and lively updates.',
  },
  {
    voiceName: 'Fenrir',
    timbre: 'Deep & Grounded',
    description: 'Measured, authoritative low register suited for treasury and operations.',
  },
];

export interface AgentVoiceProfile {
  agentId: string;
  speakerName: string;
  voiceName: AgentVoiceName;
  timbreLabel: string;
  stylePrompt: string;
  sampleLine: string;
}

interface PresetSpec {
  voiceName: AgentVoiceName;
  timbreLabel: string;
  stylePrompt: string;
  sampleLine: string;
}

const PRESET_BY_AGENT_ID: Record<string, PresetSpec> = {
  matt: {
    voiceName: 'Zephyr',
    timbreLabel: 'Zephyr · Executive Poise',
    stylePrompt:
      'Calm, crisp, reassuring Chief of Staff with warm executive poise and concise pacing',
    sampleLine:
      'Matt here, Chief of Staff. Tell me what you need and I will coordinate the right guild house right away.',
  },
  daniel: {
    voiceName: 'Charon',
    timbreLabel: 'Charon · Composed Baritone',
    stylePrompt:
      'Composed, organized Inbox and Calendar Director with calm baritone clarity and measured cadence',
    sampleLine:
      'Daniel from Inbox and Calendar. I keep your schedule clear and always hold email replies as safe drafts.',
  },
  elena: {
    voiceName: 'Kore',
    timbreLabel: 'Kore · Broadcast Showrunner',
    stylePrompt:
      'Dynamic, expressive YouTube Studio Director with confident broadcast energy and engaging inflection',
    sampleLine:
      'Elena at YouTube Studio. Ready to walk you through our latest episode hooks, scripts, and audience angles.',
  },
  marcus: {
    voiceName: 'Fenrir',
    timbreLabel: 'Fenrir · Authoritative Treasury',
    stylePrompt:
      'Measured, authoritative Finance Director with deep, deliberate precision on numbers and trade-offs',
    sampleLine:
      'Marcus in Finance and Treasury. I have the budget numbers and vendor comparisons ready whenever you want to listen.',
  },
  aria: {
    voiceName: 'Kore',
    timbreLabel: 'Kore · Scholarly Alto',
    stylePrompt:
      'Thoughtful, articulate Research Director with warm intellectual curiosity and crisp synthesis',
    sampleLine:
      'Aria from Research and Intel. I can read you any verified brief or comparison without you needing to scan the page.',
  },
  devon: {
    voiceName: 'Fenrir',
    timbreLabel: 'Fenrir · Steady Commander',
    stylePrompt:
      'Grounded, decisive Operations Director with steady, structured operational clarity',
    sampleLine:
      'Devon at Operations House. Every checklist and cross-house handoff is lined up and ready.',
  },
  layla: {
    voiceName: 'Zephyr',
    timbreLabel: 'Zephyr · Editorial Storyteller',
    stylePrompt:
      'Polished, expressive Creative Director with warm editorial rhythm and nuanced phrasing',
    sampleLine:
      'Layla in Creative and Comms. Let me read our latest draft aloud so you can hear how the tone lands.',
  },
  noah: {
    voiceName: 'Puck',
    timbreLabel: 'Puck · Energizing Coach',
    stylePrompt:
      'Encouraging, upbeat Health and Home Director with warm, energizing momentum',
    sampleLine:
      'Noah at Health and Home. Let us keep your week balanced, energized, and running smoothly.',
  },
  kieran: {
    voiceName: 'Charon',
    timbreLabel: 'Charon · Systems Architect',
    stylePrompt:
      'Focused, analytical Systems and Integrations Director with crisp technical composure',
    sampleLine:
      'Kieran in Systems and Dev. I can walk you through the API boundaries, retry logic, and architecture aloud.',
  },
  worker_daniel: {
    voiceName: 'Puck',
    timbreLabel: 'Puck · Brisk Courier',
    stylePrompt:
      'Brisk, friendly village postal and schedule courier with clear, lively pacing',
    sampleLine:
      'Sam here at the Inbox post desk—threads sorted and calendar slots checked for Daniel.',
  },
  worker_elena: {
    voiceName: 'Zephyr',
    timbreLabel: 'Zephyr · Studio Script Editor',
    stylePrompt:
      'Quick-witted studio cinematographer and script specialist with bright, conversational rhythm',
    sampleLine:
      'Maya in the edit bay—B-roll beats and opening hooks are lined up for Elena.',
  },
  worker_marcus: {
    voiceName: 'Puck',
    timbreLabel: 'Puck · Attentive Clerk',
    stylePrompt:
      'Attentive, detail-minded treasury bookkeeper with crisp, clear articulation',
    sampleLine:
      'Leo at the ledger desk—every line item and vendor quote is tallied cleanly.',
  },
  worker_aria: {
    voiceName: 'Zephyr',
    timbreLabel: 'Zephyr · Nimble Cartographer',
    stylePrompt:
      'Observant, nimble field scout and cartographer with clear, spirited delivery',
    sampleLine:
      'Zoe reporting from Research and Intel—citations verified and indexed into our single source of truth.',
  },
  worker_devon: {
    voiceName: 'Charon',
    timbreLabel: 'Charon · Master Craftsman',
    stylePrompt:
      'Practical, methodical workflow wright with warm, unhurried craftsman clarity',
    sampleLine:
      'Eli at Operations House—handoff templates are deduplicated and ready for every guild.',
  },
  worker_layla: {
    voiceName: 'Kore',
    timbreLabel: 'Kore · Atelier Artisan',
    stylePrompt:
      'Warm, expressive atelier copywriter and print artisan with poised, lyrical phrasing',
    sampleLine:
      'Nora in the Creative atelier—fresh copy variations are set on the press.',
  },
  worker_noah: {
    voiceName: 'Charon',
    timbreLabel: 'Charon · Calm Steward',
    stylePrompt:
      'Calm, restorative home and apothecary steward with gentle, unhurried warmth',
    sampleLine:
      'Owen at Health and Home—meal prep and household logistics are all in order.',
  },
  worker_kieran: {
    voiceName: 'Fenrir',
    timbreLabel: 'Fenrir · Pragmatic Tinkerer',
    stylePrompt:
      'Pragmatic copper-circuit and API tinkerer with steady, direct delivery',
    sampleLine:
      'Toby at the Systems workbench—schemas mapped and webhook retries tested.',
  },
};

const NAME_TO_AGENT_ID: Record<string, string> = {
  matt: 'matt',
  daniel: 'daniel',
  elena: 'elena',
  marcus: 'marcus',
  aria: 'aria',
  devon: 'devon',
  layla: 'layla',
  noah: 'noah',
  kieran: 'kieran',
  sam: 'worker_daniel',
  maya: 'worker_elena',
  leo: 'worker_marcus',
  zoe: 'worker_aria',
  eli: 'worker_devon',
  nora: 'worker_layla',
  owen: 'worker_noah',
  toby: 'worker_kieran',
};

const VALID_VOICES = new Set<AgentVoiceName>(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);

export function isValidAgentVoice(value: unknown): value is AgentVoiceName {
  return typeof value === 'string' && VALID_VOICES.has(value as AgentVoiceName);
}

export function pickVoiceForCustomAgent(
  name: string,
  avoidVoice?: AgentVoiceName
): AgentVoiceName {
  const pool: AgentVoiceName[] = ['Zephyr', 'Kore', 'Charon', 'Puck', 'Fenrir'].filter(
    (v) => v !== avoidVoice
  ) as AgentVoiceName[];
  const seed = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return pool[seed % pool.length] ?? 'Zephyr';
}

export function resolveAgentVoiceProfile(input: {
  id?: string;
  name?: string;
  title?: string;
  department?: string;
  voiceName?: AgentVoiceName;
}): AgentVoiceProfile {
  const rawName = (input.name || 'Villager').replace(/\s*\(Worker\)\s*$/i, '').trim();
  const normalizedNameKey = rawName.split(/[&\s]/)[0]?.toLowerCase() ?? '';
  const resolvedId = input.id || NAME_TO_AGENT_ID[normalizedNameKey] || rawName.toLowerCase();
  const preset = PRESET_BY_AGENT_ID[resolvedId] ?? PRESET_BY_AGENT_ID[NAME_TO_AGENT_ID[normalizedNameKey]];

  const chosenVoice: AgentVoiceName = isValidAgentVoice(input.voiceName)
    ? input.voiceName
    : preset?.voiceName ?? pickVoiceForCustomAgent(rawName);

  const optionMeta = AGENT_VOICE_OPTIONS.find((o) => o.voiceName === chosenVoice);

  if (preset) {
    const timbreLabel =
      chosenVoice === preset.voiceName
        ? preset.timbreLabel
        : `${chosenVoice} · ${optionMeta?.timbre ?? 'Custom Voice'}`;
    return {
      agentId: resolvedId,
      speakerName: rawName,
      voiceName: chosenVoice,
      timbreLabel,
      stylePrompt: preset.stylePrompt,
      sampleLine: preset.sampleLine,
    };
  }

  const roleDesc = input.title ? `${input.title} in ${input.department || 'Guildhaven'}` : 'Guild Specialist';
  return {
    agentId: resolvedId,
    speakerName: rawName,
    voiceName: chosenVoice,
    timbreLabel: `${chosenVoice} · ${optionMeta?.timbre ?? 'Guild Voice'}`,
    stylePrompt: `Warm, articulate ${roleDesc} speaking clearly and concisely`,
    sampleLine: `Hi, I am ${rawName}, ${roleDesc}. Ready whenever you want an audio update.`,
  };
}

/**
 * Converts Markdown deliverables, chat replies, or KB specs into clean, natural spoken prose
 * so Gemini TTS reads smoothly without speaking raw asterisks, hashes, or URLs.
 */
export function stripMarkdownForSpeech(markdown: string, maxChars = 2200): string {
  if (!markdown) return '';
  const cleaned = markdown
    // Replace fenced code blocks with a brief spoken cue instead of spelling symbols
    .replace(/```[\s\S]*?```/g, ' (Refer to the technical code block in the written report.) ')
    // Convert markdown links [label](url) -> label
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    // Remove bare URLs
    .replace(/https?:\/\/\S+/g, '')
    // Turn headings into clean sentence breaks
    .replace(/^#{1,6}\s+(.+)$/gm, '$1. ')
    // Remove bold/italic/strikethrough/inline-code markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    // Turn bullet markers into clean pauses
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Remove markdown table divider rows and pipes
    .replace(/^\s*\|?[\s:-]+\|[\s|:-]*$/gm, '')
    .replace(/\|/g, ', ')
    // Collapse excess whitespace
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();

  if (cleaned.length <= maxChars) return cleaned;
  const sliced = cleaned.slice(0, maxChars);
  const lastPeriod = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('! '), sliced.lastIndexOf('? '));
  return lastPeriod > maxChars * 0.65 ? sliced.slice(0, lastPeriod + 1) : `${sliced.trim()}...`;
}
