import React, { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Folder,
  FolderCheck,
  FolderPlus,
  Grid,
  HardDrive,
  HelpCircle,
  Keyboard,
  Loader2,
  Mail,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Tag,
  Volume2,
  X,
} from 'lucide-react';
import {
  DEFAULT_TOWN_AUTOPILOT_SETTINGS,
  describeCronExpressionSast,
  describeRuleScheduleLabel,
  validateCronExpression,
} from '../data/automationDefaults';
import { useVoicePlayer, voicePlayer } from '../lib/voicePlayer';
import type {
  AutomationRun,
  DriveWorkingFolderConfig,
  DriveWorkingFolderWriteMode,
  GmailLabelConfig,
  GmailLabelSummary,
  GoogleDriveFileSummary,
  TownAutomationRule,
  TownAutopilotSettings,
  VillageSettings,
  WorkspaceBriefing,
} from '../types/village';

export type SettingsTab = 'guardrails' | 'autopilot' | 'audio' | 'village';
export type SettingsTabInput = SettingsTab | 'drive' | 'calendar' | 'gmail';

export interface ReadOnlyExternalError extends Error {
  readOnlyExternal?: boolean;
}

function normalizeSettingsTab(tab?: SettingsTabInput): SettingsTab {
  if (tab === 'autopilot') return 'autopilot';
  if (tab === 'audio') return 'audio';
  if (tab === 'village') return 'village';
  return 'guardrails';
}

interface SettingsDrawerProps {
  initialTab?: SettingsTabInput;
  settings: VillageSettings;
  workspaceBriefing: WorkspaceBriefing;
  isGoogleConnected: boolean;
  soundEnabled: boolean;
  showWalkability: boolean;
  isRendering4k?: boolean;
  map4kActive?: boolean;
  agentCount: number;
  taskCount: number;
  knowledgeCount: number;
  onUpdateSettings: (updater: (prev: VillageSettings) => VillageSettings) => void;
  onUpdateGmailSources?: (next: {
    includeInbox: boolean;
    selectedLabels: GmailLabelConfig[];
  }) => void;
  onListGmailLabels?: () => Promise<GmailLabelSummary[]>;
  onToggleSound: () => void;
  onToggleWalkability: () => void;
  onRender4kMap?: () => void;
  onGoogleSignIn: () => void;
  onGrantWorkspaceConsent: () => Promise<void>;
  onGrantCalendarWriteConsent: () => Promise<void>;
  onListDriveFolders: (query?: string) => Promise<GoogleDriveFileSummary[]>;
  onCreateWorkingFolder: (name: string) => Promise<DriveWorkingFolderConfig>;
  onSelectWorkingFolderByUrl: (folderUrlOrId: string) => Promise<DriveWorkingFolderConfig>;
  onOpenWorkspace: (tab?: 'overview' | 'calendar' | 'chat' | 'docs' | 'drive') => void;
  onShowQuickGuide?: () => void;
  autopilotSettings?: TownAutopilotSettings;
  automationRules?: TownAutomationRule[];
  automationRuns?: AutomationRun[];
  runningRuleId?: string | null;
  onUpdateAutopilot?: (patch: {
    autopilot_settings?: Partial<TownAutopilotSettings>;
    rule_update?: Partial<TownAutomationRule> & { id: string };
  }) => Promise<void>;
  onRunRuleNow?: (ruleId: string) => Promise<void>;
  onOpenDigest?: () => void;
  onOpenApprovals?: () => void;
  onClose: () => void;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const KEYBOARD_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Arrows / WASD', action: 'Walk around the village' },
  { keys: 'Shift + Move', action: 'Sprint across the plaza' },
  { keys: 'E or Enter', action: 'Enter nearby building door' },
  { keys: 'T', action: 'Talk to nearby villager' },
  { keys: 'M M', action: 'Call Matt anywhere' },
  { keys: '/', action: 'Focus bottom task command bar' },
  { keys: 'L', action: 'Open Directory · Live Feed' },
  { keys: 'K', action: 'Open Knowledge Base' },
  { keys: 'G', action: 'Toggle walkability path grid' },
  { keys: '? / Esc', action: 'Shortcuts help / Close drawer' },
];

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  initialTab = 'guardrails',
  settings,
  workspaceBriefing,
  isGoogleConnected,
  soundEnabled,
  showWalkability,
  isRendering4k = false,
  map4kActive = false,
  agentCount,
  taskCount,
  knowledgeCount,
  onUpdateSettings,
  onUpdateGmailSources,
  onListGmailLabels,
  onToggleSound,
  onToggleWalkability,
  onRender4kMap,
  onGoogleSignIn,
  onGrantWorkspaceConsent,
  onGrantCalendarWriteConsent,
  onListDriveFolders,
  onCreateWorkingFolder,
  onSelectWorkingFolderByUrl,
  onOpenWorkspace,
  onShowQuickGuide,
  autopilotSettings = DEFAULT_TOWN_AUTOPILOT_SETTINGS,
  automationRules = [],
  automationRuns = [],
  runningRuleId = null,
  onUpdateAutopilot,
  onRunRuleNow,
  onOpenDigest,
  onOpenApprovals,
  onClose,
}) => {
  const voiceState = useVoicePlayer();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => normalizeSettingsTab(initialTab));
  const [isGrantingCalendar, setIsGrantingCalendar] = useState(false);

  // Autopilot inline rule & budget editing state
  const [maxRunsDraft, setMaxRunsDraft] = useState<number>(autopilotSettings.max_runs_per_hour);
  const [maxDurationSecDraft, setMaxDurationSecDraft] = useState<number>(
    Math.round(autopilotSettings.max_job_duration_ms / 1000)
  );
  const [maxHopsDraft, setMaxHopsDraft] = useState<number>(autopilotSettings.max_agent_hops);
  const [isSavingBudgets, setIsSavingBudgets] = useState(false);
  const [ruleTypeFilter, setRuleTypeFilter] = useState<'all' | 'cron' | 'webhook'>('all');
  const [cronEdits, setCronEdits] = useState<Record<string, string>>({});
  const [savingCronRuleId, setSavingCronRuleId] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [isTogglingGlobalAutopilot, setIsTogglingGlobalAutopilot] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<
    Record<
      string,
      {
        target_house: string;
        packet_ttl_hours: number;
        monitored_gmail_labels_text: string;
        ignore_unread_bulk: boolean;
        watched_chat_spaces_text: string;
      }
    >
  >({});
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);

  useEffect(() => {
    setMaxRunsDraft(autopilotSettings.max_runs_per_hour);
    setMaxDurationSecDraft(Math.round(autopilotSettings.max_job_duration_ms / 1000));
    setMaxHopsDraft(autopilotSettings.max_agent_hops);
  }, [
    autopilotSettings.max_runs_per_hour,
    autopilotSettings.max_job_duration_ms,
    autopilotSettings.max_agent_hops,
  ]);

  // Gmail labels state
  const [gmailLabelsCatalog, setGmailLabelsCatalog] = useState<GmailLabelSummary[]>([]);
  const [isLoadingGmailLabels, setIsLoadingGmailLabels] = useState(false);
  const [gmailLabelSearch, setGmailLabelSearch] = useState('');

  useEffect(() => {
    setActiveTab(normalizeSettingsTab(initialTab));
  }, [initialTab]);

  // Folder selection / setup state
  const [showFolderPicker, setShowFolderPicker] = useState(!settings.driveWorkingFolder);
  const [newRootFolderName, setNewRootFolderName] = useState('Guildhaven Workspace');
  const [isCreatingRootFolder, setIsCreatingRootFolder] = useState(false);
  const [folderUrlInput, setFolderUrlInput] = useState('');
  const [isLinkingFolderUrl, setIsLinkingFolderUrl] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [availableFolders, setAvailableFolders] = useState<GoogleDriveFileSummary[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Inline feedback banner
  const [statusMessage, setStatusMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  const workingFolder = settings.driveWorkingFolder;

  const loadGmailLabels = useCallback(async () => {
    if (!isGoogleConnected || !onListGmailLabels) return;
    setIsLoadingGmailLabels(true);
    try {
      const list = await onListGmailLabels();
      setGmailLabelsCatalog(list);
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to load Gmail labels.',
      });
    } finally {
      setIsLoadingGmailLabels(false);
    }
  }, [isGoogleConnected, onListGmailLabels]);

  useEffect(() => {
    if (
      isGoogleConnected &&
      (activeTab === 'guardrails' || activeTab === 'autopilot') &&
      gmailLabelsCatalog.length === 0
    ) {
      void loadGmailLabels();
    }
  }, [activeTab, gmailLabelsCatalog.length, isGoogleConnected, loadGmailLabels]);

  const mergedGmailLabels = React.useMemo(() => {
    const map = new Map<string, GmailLabelSummary>();
    for (const l of workspaceBriefing.gmailLabels ?? []) map.set(l.id, l);
    for (const l of workspaceBriefing.activeGmailSources ?? []) {
      map.set(l.id, { ...(map.get(l.id) ?? l), ...l });
    }
    for (const l of gmailLabelsCatalog) {
      map.set(l.id, { ...(map.get(l.id) ?? l), ...l });
    }
    return Array.from(map.values());
  }, [gmailLabelsCatalog, workspaceBriefing.activeGmailSources, workspaceBriefing.gmailLabels]);

  const applyGmailSources = (next: {
    includeInbox: boolean;
    selectedLabels: GmailLabelConfig[];
  }) => {
    if (onUpdateGmailSources) {
      onUpdateGmailSources(next);
    } else {
      onUpdateSettings((prev) => ({
        ...prev,
        gmailIncludeInbox: next.includeInbox,
        gmailSelectedLabels: next.selectedLabels,
      }));
    }
  };

  useEffect(() => {
    if (workingFolder) {
      setShowFolderPicker(false);
    } else {
      setShowFolderPicker(true);
    }
  }, [workingFolder?.id, workingFolder?.name]);

  const loadAvailableFolders = useCallback(
    async (query?: string) => {
      if (!isGoogleConnected) return;
      setIsLoadingFolders(true);
      setStatusMessage(null);
      try {
        const list = await onListDriveFolders(query);
        setAvailableFolders(list);
      } catch (err) {
        setStatusMessage({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Unable to list Google Drive folders.',
        });
      } finally {
        setIsLoadingFolders(false);
      }
    },
    [isGoogleConnected, onListDriveFolders]
  );

  useEffect(() => {
    if (!isGoogleConnected) return;
    if (showFolderPicker) {
      void loadAvailableFolders(folderSearchQuery);
    }
  }, [isGoogleConnected, showFolderPicker]);

  const handleCreateRootFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRootFolderName.trim() || isCreatingRootFolder) return;
    setIsCreatingRootFolder(true);
    setStatusMessage(null);
    try {
      const created = await onCreateWorkingFolder(newRootFolderName.trim());
      setShowFolderPicker(false);
      setStatusMessage({
        tone: 'ok',
        text: `Created and linked "${created.name}" as your Google Drive Working Folder.`,
      });
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to create Working Folder.',
      });
    } finally {
      setIsCreatingRootFolder(false);
    }
  };

  const handleSelectExistingFolder = (folder: GoogleDriveFileSummary) => {
    const config: DriveWorkingFolderConfig = {
      id: folder.id,
      name: folder.name,
      webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      configuredAt: new Date().toISOString(),
    };
    onUpdateSettings((prev) => ({
      ...prev,
      driveWorkingFolder: config,
    }));
    setShowFolderPicker(false);
    setStatusMessage({
      tone: 'ok',
      text: `Set "${folder.name}" as your Google Drive Working Folder.`,
    });
  };

  const handleLinkFolderByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderUrlInput.trim() || isLinkingFolderUrl) return;
    setIsLinkingFolderUrl(true);
    setStatusMessage(null);
    try {
      const linked = await onSelectWorkingFolderByUrl(folderUrlInput.trim());
      setFolderUrlInput('');
      setShowFolderPicker(false);
      setStatusMessage({
        tone: 'ok',
        text: `Linked "${linked.name}" as your Google Drive Working Folder.`,
      });
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not link folder URL or ID.',
      });
    } finally {
      setIsLinkingFolderUrl(false);
    }
  };

  const handleClearWorkingFolder = () => {
    onUpdateSettings((prev) => ({
      ...prev,
      driveWorkingFolder: null,
    }));
    setShowFolderPicker(true);
    setStatusMessage({
      tone: 'ok',
      text: 'Cleared Working Folder selection (nothing was deleted in Google Drive).',
    });
  };

  const setWriteMode = (mode: DriveWorkingFolderWriteMode) => {
    onUpdateSettings((prev) => ({
      ...prev,
      driveWorkingFolderWriteMode: mode,
    }));
  };

  const googleSignInButton = (
    <button
      type="button"
      onClick={onGoogleSignIn}
      className="gsi-material-button"
    >
      <div className="gsi-material-button-content-wrapper">
        <div className="gsi-material-button-icon">
          <svg
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            style={{ display: 'block' }}
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        </div>
        <span className="gsi-material-button-contents">Sign in with Google</span>
      </div>
    </button>
  );

  return (
    <aside className="fixed right-0 top-14 bottom-0 z-30 flex w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <Settings className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white whitespace-nowrap">Settings</h2>
          </div>

          <div className="flex items-center gap-1 border-l border-slate-800 pl-3 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('guardrails')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'guardrails'
                  ? 'bg-slate-800 text-amber-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Guardrails
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('autopilot')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'autopilot'
                  ? 'bg-slate-800 text-amber-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Autopilot
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audio')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'audio'
                  ? 'bg-slate-800 text-amber-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Voice &amp; Audio
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('village')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'village'
                  ? 'bg-slate-800 text-amber-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Map &amp; Display
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close Settings"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {statusMessage && (
          <div
            className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs ${
              statusMessage.tone === 'error'
                ? 'border-rose-500/40 bg-rose-950/50 text-rose-200'
                : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white cursor-pointer shrink-0"
              aria-label="Dismiss message"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {activeTab === 'guardrails' ? (
          <>
            {/* Section 1: Google Drive Working Folder Policy */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-orange-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-white">Google Drive Working Folder</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Designate the default Drive folder for team deliverables and choose whether saves happen automatically or require confirmation.
                  </p>
                </div>
                {isGoogleConnected && (
                  <button
                    type="button"
                    onClick={() => onOpenWorkspace('drive')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-950/30 px-2.5 py-1.5 text-xs font-medium text-orange-200 hover:bg-orange-950/60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Browse &amp; Edit Files in Workspace</span>
                  </button>
                )}
              </div>

              {!isGoogleConnected ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Sign in with your Google account to select or create a Google Drive Working Folder.
                  </p>
                  {googleSignInButton}
                </div>
              ) : workspaceBriefing.driveStatus === 'needs_consent' ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-3">
                  <p className="text-xs text-slate-200 leading-relaxed">
                    Grant Google Drive permission so Guildhaven can list folders and save deliverables into your Working Folder.
                  </p>
                  <button
                    type="button"
                    onClick={() => void onGrantWorkspaceConsent()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Grant Workspace Access</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {workingFolder && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-4 space-y-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <FolderCheck className="h-5 w-5 text-orange-400 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {workingFolder.name}
                            </p>
                            <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                              Active Working Folder
                              {workingFolder.configuredAt
                                ? ` · Linked ${formatShortDate(workingFolder.configuredAt)}`
                                : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={
                              workingFolder.webViewLink ||
                              `https://drive.google.com/drive/folders/${workingFolder.id}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-orange-300 hover:border-orange-500/60 hover:text-orange-200 whitespace-nowrap shrink-0"
                          >
                            <span>Open in Drive</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => setShowFolderPicker((v) => !v)}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {showFolderPicker ? 'Hide Picker' : 'Change Folder'}
                          </button>
                          <button
                            type="button"
                            onClick={handleClearWorkingFolder}
                            className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      {/* Write Policy & Auto-Include Context */}
                      <div className="grid grid-cols-1 gap-3 border-t border-slate-800/90 pt-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-300">
                            Generated Content Save Policy
                          </p>
                          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
                            <button
                              type="button"
                              onClick={() => setWriteMode('direct_in_folder')}
                              className={`flex-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                settings.driveWorkingFolderWriteMode === 'direct_in_folder'
                                  ? 'bg-orange-500 text-slate-950 font-semibold'
                                  : 'text-slate-300 hover:text-white'
                              }`}
                            >
                              Auto-save in folder
                            </button>
                            <button
                              type="button"
                              onClick={() => setWriteMode('confirm_each_write')}
                              className={`flex-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                settings.driveWorkingFolderWriteMode === 'confirm_each_write'
                                  ? 'bg-orange-500 text-slate-950 font-semibold'
                                  : 'text-slate-300 hover:text-white'
                              }`}
                            >
                              Confirm each save
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-snug">
                            {settings.driveWorkingFolderWriteMode === 'direct_in_folder'
                              ? 'Deliverables write directly inside this folder without extra save dialogs.'
                              : 'Always prompt for confirmation before writing files into this folder.'}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-300">
                            Village Prompt Grounding
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSettings((prev) => ({
                                ...prev,
                                autoSyncWorkingFolderContext: !prev.autoSyncWorkingFolderContext,
                              }))
                            }
                            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                              settings.autoSyncWorkingFolderContext
                                ? 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200'
                                : 'border-slate-800 bg-slate-900 text-slate-300 hover:text-white'
                            }`}
                          >
                            <span>Share folder index with agents</span>
                            <span className="font-mono text-[11px]">
                              {settings.autoSyncWorkingFolderContext ? 'ON' : 'OFF'}
                            </span>
                          </button>
                          <p className="text-[11px] text-slate-500 leading-snug">
                            Matt and Directors automatically see files stored in this folder during tasks.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Folder Picker / Creator */}
                  {showFolderPicker && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-4 space-y-4">
                      <form onSubmit={(e) => void handleCreateRootFolder(e)} className="space-y-2">
                        <p className="text-xs font-semibold text-white">
                          Create a New Dedicated Working Folder
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Recommended for full edit, rename, and delete control under Google Drive&apos;s app-created file permissions.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newRootFolderName}
                            onChange={(e) => setNewRootFolderName(e.target.value)}
                            placeholder="Folder name (e.g. Guildhaven Workspace)"
                            className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isCreatingRootFolder || !newRootFolderName.trim()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {isCreatingRootFolder ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FolderPlus className="h-3.5 w-3.5" />
                            )}
                            <span>{isCreatingRootFolder ? 'Creating...' : 'Create & Select'}</span>
                          </button>
                        </div>
                      </form>

                      <div className="border-t border-slate-800 pt-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-white">
                            Or Pick an Existing Google Drive Folder
                          </p>
                          <button
                            type="button"
                            onClick={() => void loadAvailableFolders(folderSearchQuery)}
                            disabled={isLoadingFolders}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isLoadingFolders ? 'animate-spin' : ''}`}
                            />
                            <span>Refresh</span>
                          </button>
                        </div>

                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void loadAvailableFolders(folderSearchQuery);
                          }}
                          className="flex items-center gap-2"
                        >
                          <div className="relative flex-1 min-w-0">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                            <input
                              type="text"
                              value={folderSearchQuery}
                              onChange={(e) => setFolderSearchQuery(e.target.value)}
                              placeholder="Filter Drive folders by name..."
                              className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={isLoadingFolders}
                            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Search
                          </button>
                        </form>

                        {isLoadingFolders ? (
                          <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" />
                            <span>Loading folders from Google Drive...</span>
                          </div>
                        ) : availableFolders.length === 0 ? (
                          <p className="text-[11px] text-slate-500 py-1">
                            No matching folders found. Create a new Working Folder above or paste a folder URL below.
                          </p>
                        ) : (
                          <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-slate-900/70">
                            {availableFolders.map((folder) => {
                              const isSelected = workingFolder?.id === folder.id;
                              return (
                                <div
                                  key={folder.id}
                                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-800/60"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Folder className="h-4 w-4 text-orange-400 shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium text-slate-100 truncate">
                                        {folder.name}
                                      </p>
                                      {folder.modifiedTime && (
                                        <p className="text-[10px] text-slate-500 tabular-nums">
                                          Modified {formatShortDate(folder.modifiedTime)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectExistingFolder(folder)}
                                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                                      isSelected
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : 'bg-slate-800 text-slate-200 border border-slate-700 hover:border-amber-400 hover:text-white'
                                    }`}
                                  >
                                    {isSelected && <Check className="h-3 w-3" />}
                                    <span>{isSelected ? 'Selected' : 'Use Folder'}</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <form
                        onSubmit={(e) => void handleLinkFolderByUrl(e)}
                        className="border-t border-slate-800 pt-3 space-y-1.5"
                      >
                        <label className="block text-[11px] font-medium text-slate-400">
                          Or Paste a Google Drive Folder URL / ID
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={folderUrlInput}
                            onChange={(e) => setFolderUrlInput(e.target.value)}
                            placeholder="https://drive.google.com/drive/folders/..."
                            className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={isLinkingFolderUrl || !folderUrlInput.trim()}
                            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {isLinkingFolderUrl ? 'Linking...' : 'Link Folder'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Section 2: Google Calendar Access Policy */}
            <section className="border-t border-slate-800 pt-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-sky-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-white">Google Calendar Access</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Choose whether Google Calendar stays strictly read-only or allows creating, updating, and removing events with explicit confirmation.
                  </p>
                </div>
                {isGoogleConnected && (
                  <button
                    type="button"
                    onClick={() => onOpenWorkspace('calendar')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-950/30 px-2.5 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-950/60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Manage Events in Workspace</span>
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-4 space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-white">Calendar Write Policy</p>
                  <div
                    role="group"
                    aria-label="Google Calendar access mode"
                    className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1"
                  >
                    <button
                      type="button"
                      aria-pressed={!settings.calendarWriteAccess}
                      onClick={() => {
                        onUpdateSettings((prev) => ({
                          ...prev,
                          calendarWriteAccess: false,
                        }));
                        setStatusMessage({
                          tone: 'ok',
                          text: 'Google Calendar set to Read-Only mode. Creating, editing, or deleting events is disabled.',
                        });
                      }}
                      className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        !settings.calendarWriteAccess
                          ? 'bg-slate-700 text-white font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Read-Only
                    </button>
                    <button
                      type="button"
                      aria-pressed={settings.calendarWriteAccess}
                      disabled={isGrantingCalendar}
                      onClick={() => {
                        onUpdateSettings((prev) => ({
                          ...prev,
                          calendarWriteAccess: true,
                        }));
                        if (
                          isGoogleConnected &&
                          workspaceBriefing.calendarStatus !== 'connected_write'
                        ) {
                          setIsGrantingCalendar(true);
                          setStatusMessage({
                            tone: 'ok',
                            text: 'Calendar Write Access enabled. Requesting Google Calendar write permission...',
                          });
                          void onGrantCalendarWriteConsent()
                            .then(() => {
                              setStatusMessage({
                                tone: 'ok',
                                text: 'Calendar Write Access enabled and Google Calendar write permission authorized.',
                              });
                            })
                            .catch((err) => {
                              setStatusMessage({
                                tone: 'error',
                                text:
                                  err instanceof Error
                                    ? `${err.message} Click "Grant Calendar Write Access" below to try again.`
                                    : 'Calendar Write Access enabled. Click "Grant Calendar Write Access" below to authorize Google Calendar.',
                              });
                            })
                            .finally(() => {
                              setIsGrantingCalendar(false);
                            });
                        } else {
                          setStatusMessage({
                            tone: 'ok',
                            text:
                              workspaceBriefing.calendarStatus === 'connected_write'
                                ? 'Google Calendar Write Access enabled.'
                                : 'Calendar Write Access enabled. Sign in with Google below to authorize event creation & editing.',
                          });
                        }
                      }}
                      className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        settings.calendarWriteAccess
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {isGrantingCalendar ? 'Authorizing...' : 'Write Access Enabled'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {settings.calendarWriteAccess
                      ? 'You can schedule, edit, and remove events in the Workspace Hub, and Daniel can stage scheduled events in Approvals. Every change still asks for your confirmation first.'
                      : 'Agents and Workspace Hub can only view upcoming events. All event creation, updates, and deletions are blocked.'}
                  </p>
                </div>

                <div className="border-t border-slate-800/90 pt-3.5 space-y-3">
                  {!isGoogleConnected ? (
                    <div className="space-y-2.5">
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Sign in with your Google account to sync your primary Google Calendar{settings.calendarWriteAccess ? ' and authorize event write access' : ''}.
                      </p>
                      {googleSignInButton}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-white">
                          Google Account Permission
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {!settings.calendarWriteAccess
                            ? 'Active permission: View calendar events (Read-Only)'
                            : workspaceBriefing.calendarStatus === 'connected_write'
                              ? 'Authorized: View, create, edit, and remove calendar events'
                              : 'Permission needed: Grant Google Calendar write permission'}
                        </p>
                      </div>
                      {settings.calendarWriteAccess &&
                        workspaceBriefing.calendarStatus !== 'connected_write' && (
                          <button
                            type="button"
                            disabled={isGrantingCalendar}
                            onClick={async () => {
                              setIsGrantingCalendar(true);
                              setStatusMessage(null);
                              try {
                                await onGrantCalendarWriteConsent();
                                setStatusMessage({
                                  tone: 'ok',
                                  text: 'Google Calendar write permission granted.',
                                });
                              } catch (err) {
                                setStatusMessage({
                                  tone: 'error',
                                  text:
                                    err instanceof Error
                                      ? err.message
                                      : 'Unable to authorize Google Calendar write access.',
                                });
                              } finally {
                                setIsGrantingCalendar(false);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {isGrantingCalendar ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Calendar className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {isGrantingCalendar ? 'Authorizing...' : 'Grant Calendar Write Access'}
                            </span>
                          </button>
                        )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Section 3: Gmail Inbox & Monitored Labels */}
            <section className="border-t border-slate-800 pt-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-emerald-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-white">
                      Gmail Inbox &amp; Monitored Labels
                    </h3>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Choose whether Primary Inbox is included and select additional Gmail labels (such as custom project, VIP, or filtered labels) for Guildhaven and Daniel to read.
                  </p>
                </div>
                {isGoogleConnected && (
                  <button
                    type="button"
                    onClick={() => onOpenWorkspace('overview')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-950/60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Tag className="h-3.5 w-3.5" />
                    <span>Open Gmail in Workspace</span>
                  </button>
                )}
              </div>

              {!isGoogleConnected ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Sign in with Google to view your Gmail labels and configure monitored sources alongside Primary Inbox.
                  </p>
                  {googleSignInButton}
                </div>
              ) : (
                (() => {
                  const includeInbox = settings.gmailIncludeInbox !== false;
                  const selectedLabels = settings.gmailSelectedLabels ?? [];
                  const inboxDetail = mergedGmailLabels.find((l) => l.id === 'INBOX');
                  const nonInboxLabels = mergedGmailLabels.filter((l) => l.id !== 'INBOX');
                  const qLower = gmailLabelSearch.trim().toLowerCase();
                  const filtered = qLower
                    ? nonInboxLabels.filter((l) => l.name.toLowerCase().includes(qLower))
                    : nonInboxLabels;
                  const customLabels = filtered.filter((l) => l.type === 'user');
                  const systemLabels = filtered.filter((l) => l.type === 'system');

                  return (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-4 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="text-slate-300">
                          <span className="text-slate-400">Active sources: </span>
                          <span className="font-medium text-white">
                            {!includeInbox && selectedLabels.length === 0
                              ? 'None selected'
                              : [
                                  ...(includeInbox ? ['Primary Inbox'] : []),
                                  ...selectedLabels.map((l) => l.name),
                                ].join(' · ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          {(!includeInbox || selectedLabels.length > 0) && (
                            <button
                              type="button"
                              onClick={() => {
                                applyGmailSources({ includeInbox: true, selectedLabels: [] });
                                setStatusMessage({
                                  tone: 'ok',
                                  text: 'Reset Gmail sources to Primary Inbox only.',
                                });
                              }}
                              className="text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Reset to Inbox
                            </button>
                          )}
                          {onListGmailLabels && (
                            <button
                              type="button"
                              onClick={() => void loadGmailLabels()}
                              disabled={isLoadingGmailLabels}
                              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${isLoadingGmailLabels ? 'animate-spin' : ''}`}
                              />
                              <span>Refresh Labels</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Primary Inbox Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          const nextInclude = !includeInbox;
                          applyGmailSources({
                            includeInbox: nextInclude,
                            selectedLabels,
                          });
                          setStatusMessage({
                            tone: 'ok',
                            text: nextInclude
                              ? 'Primary Inbox included in Gmail sync.'
                              : 'Primary Inbox excluded — syncing selected Gmail labels only.',
                          });
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                          includeInbox
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-white'
                            : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                              includeInbox
                                ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                : 'border-slate-600 bg-slate-950'
                            }`}
                          >
                            {includeInbox && <Check className="h-3 w-3 stroke-[3]" />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">Primary Inbox (INBOX)</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              Sync standard incoming messages arriving in your Inbox
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-300 shrink-0">
                          {typeof inboxDetail?.messagesUnread === 'number'
                            ? `${inboxDetail.messagesUnread} unread · `
                            : ''}
                          {includeInbox ? 'Included' : 'Excluded'}
                        </span>
                      </button>

                      {/* Searchable Label Checklist */}
                      <div className="space-y-2 border-t border-slate-800/90 pt-3">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                          <input
                            type="text"
                            value={gmailLabelSearch}
                            onChange={(e) => setGmailLabelSearch(e.target.value)}
                            placeholder="Filter Gmail labels by name..."
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                          />
                          {gmailLabelSearch && (
                            <button
                              type="button"
                              onClick={() => setGmailLabelSearch('')}
                              aria-label="Clear Gmail label filter"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {isLoadingGmailLabels && nonInboxLabels.length === 0 ? (
                          <div className="flex items-center gap-2 py-2.5 text-xs text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                            <span>Loading labels from Gmail...</span>
                          </div>
                        ) : filtered.length === 0 ? (
                          <p className="text-[11px] text-slate-500 py-1">
                            {nonInboxLabels.length === 0
                              ? 'No additional Gmail labels returned yet. Click Refresh Labels to reload.'
                              : 'No Gmail labels match that search.'}
                          </p>
                        ) : (
                          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/75 divide-y divide-slate-800/80">
                            {customLabels.length > 0 && (
                              <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-slate-950">
                                Custom Labels ({customLabels.length})
                              </div>
                            )}
                            {customLabels.map((lbl) => {
                              const isSelected = selectedLabels.some((s) => s.id === lbl.id);
                              return (
                                <button
                                  key={lbl.id}
                                  type="button"
                                  onClick={() => {
                                    const nextLabels = isSelected
                                      ? selectedLabels.filter((s) => s.id !== lbl.id)
                                      : [
                                          ...selectedLabels,
                                          { id: lbl.id, name: lbl.name, type: lbl.type },
                                        ];
                                    applyGmailSources({
                                      includeInbox,
                                      selectedLabels: nextLabels,
                                    });
                                  }}
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-800/70 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                      className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                                        isSelected
                                          ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                          : 'border-slate-600 bg-slate-950'
                                      }`}
                                    >
                                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                                    </span>
                                    <span className="text-xs font-medium text-slate-100 truncate">
                                      {lbl.name}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                                    {typeof lbl.messagesUnread === 'number'
                                      ? `${lbl.messagesUnread} unread`
                                      : isSelected
                                        ? 'Selected'
                                        : ''}
                                  </span>
                                </button>
                              );
                            })}

                            {systemLabels.length > 0 && (
                              <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-slate-950">
                                Gmail System Views ({systemLabels.length})
                              </div>
                            )}
                            {systemLabels.map((lbl) => {
                              const isSelected = selectedLabels.some((s) => s.id === lbl.id);
                              return (
                                <button
                                  key={lbl.id}
                                  type="button"
                                  onClick={() => {
                                    const nextLabels = isSelected
                                      ? selectedLabels.filter((s) => s.id !== lbl.id)
                                      : [
                                          ...selectedLabels,
                                          { id: lbl.id, name: lbl.name, type: lbl.type },
                                        ];
                                    applyGmailSources({
                                      includeInbox,
                                      selectedLabels: nextLabels,
                                    });
                                  }}
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-800/70 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                      className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                                        isSelected
                                          ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                          : 'border-slate-600 bg-slate-950'
                                      }`}
                                    >
                                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                                    </span>
                                    <span className="text-xs font-medium text-slate-200 truncate">
                                      {lbl.name}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                                    {typeof lbl.messagesUnread === 'number'
                                      ? `${lbl.messagesUnread} unread`
                                      : isSelected
                                        ? 'Selected'
                                        : ''}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </section>
          </>
        ) : activeTab === 'autopilot' ? (
          <div className="space-y-5">
            {/* Global Kill-Switch & Safety Budgets */}
            <section className="rounded-xl border border-slate-800 bg-slate-950/75 p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                    <h3 className="text-sm font-semibold text-white">
                      Supervised Town Autopilot
                    </h3>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        autopilotSettings.autopilot_enabled
                          ? 'text-emerald-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {autopilotSettings.autopilot_enabled ? 'Active' : 'Paused'}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-slate-400">
                      {automationRules.filter((r) => r.enabled).length} of {automationRules.length} rules enabled
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Executes internal read, research, triage, and drafting schedules in the background while strictly enforcing KB-GOV-01: all external emails, Calendar writes, Google Chat replies, and live KB updates pause in Pending Approvals.
                  </p>
                </div>

                {onUpdateAutopilot && (
                  <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
                    <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
                      {autopilotSettings.autopilot_enabled ? 'Enabled' : 'Paused'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autopilotSettings.autopilot_enabled}
                      aria-label="Toggle Supervised Town Autopilot"
                      disabled={isTogglingGlobalAutopilot}
                      onClick={async () => {
                        const nextEnabled = !autopilotSettings.autopilot_enabled;
                        setIsTogglingGlobalAutopilot(true);
                        setStatusMessage(null);
                        try {
                          await onUpdateAutopilot({
                            autopilot_settings: { autopilot_enabled: nextEnabled },
                          });
                          setStatusMessage({
                            tone: 'ok',
                            text: nextEnabled
                              ? 'Town Autopilot resumed. Scheduled heartbeats and monitored webhooks are active.'
                              : 'Town Autopilot paused. Background cron and webhook triggers are halted (manual Test Run Now remains available).',
                          });
                        } catch (err) {
                          setStatusMessage({
                            tone: 'error',
                            text:
                              err instanceof Error ? err.message : 'Failed to toggle Town Autopilot.',
                          });
                        } finally {
                          setIsTogglingGlobalAutopilot(false);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 cursor-pointer disabled:opacity-50 ${
                        autopilotSettings.autopilot_enabled
                          ? 'border-emerald-400/50 bg-emerald-500'
                          : 'border-slate-700 bg-slate-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
                          autopilotSettings.autopilot_enabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Fail-Closed Runtime Budgets */}
              <div className="border-t border-slate-800/90 pt-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white">
                    Fail-Closed Runtime Guardrails (KB-SOP-01)
                  </p>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    Read-only tools + staged packets only
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max Runs / Hour
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={maxRunsDraft}
                      onChange={(e) => setMaxRunsDraft(Number(e.target.value) || 1)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white font-mono tabular-nums focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Job Timeout (sec)
                    </label>
                    <input
                      type="number"
                      min={3}
                      max={120}
                      value={maxDurationSecDraft}
                      onChange={(e) => setMaxDurationSecDraft(Number(e.target.value) || 3)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white font-mono tabular-nums focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max Agent Hops
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={maxHopsDraft}
                      onChange={(e) => setMaxHopsDraft(Number(e.target.value) || 1)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white font-mono tabular-nums focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                {onUpdateAutopilot &&
                  (maxRunsDraft !== autopilotSettings.max_runs_per_hour ||
                    maxDurationSecDraft * 1000 !== autopilotSettings.max_job_duration_ms ||
                    maxHopsDraft !== autopilotSettings.max_agent_hops) && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setMaxRunsDraft(autopilotSettings.max_runs_per_hour);
                          setMaxDurationSecDraft(
                            Math.round(autopilotSettings.max_job_duration_ms / 1000)
                          );
                          setMaxHopsDraft(autopilotSettings.max_agent_hops);
                        }}
                        className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        disabled={isSavingBudgets}
                        onClick={async () => {
                          setIsSavingBudgets(true);
                          setStatusMessage(null);
                          try {
                            await onUpdateAutopilot({
                              autopilot_settings: {
                                max_runs_per_hour: maxRunsDraft,
                                max_job_duration_ms: maxDurationSecDraft * 1000,
                                max_agent_hops: maxHopsDraft,
                              },
                            });
                            setStatusMessage({
                              tone: 'ok',
                              text: 'Updated Autopilot rate, timeout, and hop guardrails.',
                            });
                          } catch (err) {
                            setStatusMessage({
                              tone: 'error',
                              text:
                                err instanceof Error
                                  ? err.message
                                  : 'Failed to save Autopilot guardrails.',
                            });
                          } finally {
                            setIsSavingBudgets(false);
                          }
                        }}
                        className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {isSavingBudgets ? 'Saving...' : 'Save Guardrails'}
                      </button>
                    </div>
                  )}
              </div>
            </section>

            {/* Dedicated Automation Rules List */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold text-white tabular-nums">
                    Automation Rules ({automationRules.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Toggle rules on/off, edit 5-field UTC cron schedules (live SAST preview), or run an immediate safe-zone test.
                  </p>
                </div>

                {/* Rule Type Filter Segmented Control */}
                <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                  {(
                    [
                      ['all', `All (${automationRules.length})`],
                      [
                        'cron',
                        `Cron (${automationRules.filter((r) => r.type === 'cron').length})`,
                      ],
                      [
                        'webhook',
                        `Webhooks (${automationRules.filter((r) => r.type === 'webhook').length})`,
                      ],
                    ] as const
                  ).map(([filterKey, label]) => (
                    <button
                      key={filterKey}
                      type="button"
                      onClick={() => setRuleTypeFilter(filterKey)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                        ruleTypeFilter === filterKey
                          ? 'bg-slate-800 text-amber-300 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {automationRules
                  .filter((r) => (ruleTypeFilter === 'all' ? true : r.type === ruleTypeFilter))
                  .map((rule) => {
                    const isExpanded = expandedRuleId === rule.id;
                    const isRunningThis = runningRuleId === rule.id;
                    const isTogglingThis = togglingRuleId === rule.id;
                    const isSavingCron = savingCronRuleId === rule.id;
                    const savedCron = (rule.schedule_cron ?? '30 5 * * 1-5').trim();
                    const currentCronInput = cronEdits[rule.id] ?? savedCron;
                    const isCronDirty =
                      rule.type === 'cron' && currentCronInput.trim() !== savedCron;
                    const cronValidation =
                      rule.type === 'cron'
                        ? validateCronExpression(currentCronInput)
                        : { valid: true };
                    const liveCronPreview =
                      rule.type === 'cron'
                        ? describeCronExpressionSast(
                            currentCronInput,
                            rule.timezone || 'Africa/Johannesburg'
                          )
                        : describeRuleScheduleLabel(rule);

                    const latestRunForRule = automationRuns.find((r) => r.rule_id === rule.id);

                    const draft = ruleDrafts[rule.id] ?? {
                      target_house: rule.target_house,
                      packet_ttl_hours: rule.config.packet_ttl_hours,
                      monitored_gmail_labels_text: (
                        rule.config.monitored_gmail_labels ?? []
                      ).join(', '),
                      ignore_unread_bulk: rule.config.ignore_unread_bulk !== false,
                      watched_chat_spaces_text: (
                        rule.config.watched_chat_spaces ?? []
                      ).join(', '),
                    };

                    const saveInlineCronSchedule = async (cronValueToSave?: string) => {
                      if (!onUpdateAutopilot || rule.type !== 'cron') return;
                      const candidate = (cronValueToSave ?? currentCronInput).trim();
                      const check = validateCronExpression(candidate);
                      if (!check.valid) {
                        setStatusMessage({
                          tone: 'error',
                          text: check.error || 'Invalid 5-field cron schedule.',
                        });
                        return;
                      }
                      setSavingCronRuleId(rule.id);
                      setStatusMessage(null);
                      try {
                        await onUpdateAutopilot({
                          rule_update: {
                            id: rule.id,
                            schedule_cron: candidate,
                          },
                        });
                        setCronEdits((prev) => {
                          const next = { ...prev };
                          delete next[rule.id];
                          return next;
                        });
                        setStatusMessage({
                          tone: 'ok',
                          text: `Updated schedule for "${rule.name}" to ${describeCronExpressionSast(
                            candidate,
                            rule.timezone || 'Africa/Johannesburg'
                          )}.`,
                        });
                      } catch (err) {
                        setStatusMessage({
                          tone: 'error',
                          text:
                            err instanceof Error
                              ? err.message
                              : 'Failed to update cron schedule.',
                        });
                      } finally {
                        setSavingCronRuleId(null);
                      }
                    };

                    const toggleScopeEditor = () => {
                      if (isExpanded) {
                        setExpandedRuleId(null);
                        return;
                      }
                      setRuleDrafts((prev) => ({
                        ...prev,
                        [rule.id]: {
                          target_house: rule.target_house,
                          packet_ttl_hours: rule.config.packet_ttl_hours,
                          monitored_gmail_labels_text: (
                            rule.config.monitored_gmail_labels ?? []
                          ).join(', '),
                          ignore_unread_bulk: rule.config.ignore_unread_bulk !== false,
                          watched_chat_spaces_text: (
                            rule.config.watched_chat_spaces ?? []
                          ).join(', '),
                        },
                      }));
                      setExpandedRuleId(rule.id);
                    };

                    return (
                      <div
                        key={rule.id}
                        className={`rounded-xl border p-4 space-y-3 transition-colors ${
                          rule.enabled
                            ? 'border-slate-800 bg-slate-950/75'
                            : 'border-slate-800/70 bg-slate-950/40'
                        }`}
                      >
                        {/* Top Row: Rule Title/Metadata + Manual Test Run Now + Toggle Switch */}
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p
                                className={`text-xs font-semibold ${
                                  rule.enabled ? 'text-white' : 'text-slate-300'
                                }`}
                              >
                                {rule.name}
                              </p>
                              <span className="font-mono text-[11px] text-slate-500">
                                ({rule.id})
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 tabular-nums">
                              <span className="text-sky-300 font-medium">
                                {rule.type === 'cron' ? 'Scheduled Cron' : 'Event Webhook'}
                              </span>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span>House: {rule.target_house}</span>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span>TTL {rule.config.packet_ttl_hours}h</span>
                              {rule.last_run_at && (
                                <>
                                  <span className="text-slate-600" aria-hidden="true">·</span>
                                  <span className="text-slate-500">
                                    Last run {formatShortDate(rule.last_run_at)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0">
                            {onRunRuleNow && (
                              <button
                                type="button"
                                disabled={Boolean(runningRuleId)}
                                onClick={async () => {
                                  setStatusMessage(null);
                                  try {
                                    await onRunRuleNow(rule.id);
                                    setStatusMessage({
                                      tone: 'ok',
                                      text: `Completed manual test run for "${rule.name}". Results logged to Town Digest (and Pending Approvals if a packet was staged).`,
                                    });
                                  } catch (err) {
                                    setStatusMessage({
                                      tone: 'error',
                                      text:
                                        err instanceof Error
                                          ? err.message
                                          : 'Manual test run failed.',
                                    });
                                  }
                                }}
                                title={`Execute a manual safe-zone test run of "${rule.name}" right now`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/45 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                {isRunningThis ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    <span>Testing...</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="h-3.5 w-3.5" />
                                    <span>Test Run Now</span>
                                  </>
                                )}
                              </button>
                            )}

                            {onUpdateAutopilot && (
                              <div className="inline-flex items-center gap-2 pl-1">
                                <span
                                  className={`text-[11px] font-medium tabular-nums whitespace-nowrap ${
                                    rule.enabled ? 'text-emerald-300' : 'text-slate-500'
                                  }`}
                                >
                                  {rule.enabled ? 'On' : 'Off'}
                                </span>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={rule.enabled}
                                  aria-label={`Toggle ${rule.name}`}
                                  disabled={isTogglingThis}
                                  onClick={async () => {
                                    const nextEnabled = !rule.enabled;
                                    setTogglingRuleId(rule.id);
                                    setStatusMessage(null);
                                    try {
                                      await onUpdateAutopilot({
                                        rule_update: { id: rule.id, enabled: nextEnabled },
                                      });
                                    } catch (err) {
                                      setStatusMessage({
                                        tone: 'error',
                                        text:
                                          err instanceof Error
                                            ? err.message
                                            : 'Failed to toggle automation rule.',
                                      });
                                    } finally {
                                      setTogglingRuleId(null);
                                    }
                                  }}
                                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 cursor-pointer disabled:opacity-50 ${
                                    rule.enabled
                                      ? 'border-emerald-400/50 bg-emerald-500'
                                      : 'border-slate-700 bg-slate-800'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150 ${
                                      rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
                                    }`}
                                  />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {rule.description && (
                          <p className="text-xs text-slate-400 leading-relaxed">
                            {rule.description}
                          </p>
                        )}

                        {/* Inline Editable Cron Schedule Bar (or Webhook Trigger Readout) */}
                        {rule.type === 'cron' ? (
                          <div className="border-t border-slate-800/80 pt-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label
                                htmlFor={`cron-input-${rule.id}`}
                                className="text-[11px] font-medium text-slate-300"
                              >
                                Cron Schedule (5-field UTC)
                              </label>
                              <span
                                className={`text-[11px] tabular-nums ${
                                  cronValidation.valid ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                {cronValidation.valid
                                  ? liveCronPreview
                                  : cronValidation.error}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                id={`cron-input-${rule.id}`}
                                type="text"
                                value={currentCronInput}
                                onChange={(e) =>
                                  setCronEdits((prev) => ({
                                    ...prev,
                                    [rule.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (isCronDirty && cronValidation.valid && !isSavingCron) {
                                      void saveInlineCronSchedule();
                                    }
                                  }
                                }}
                                disabled={!onUpdateAutopilot || isSavingCron}
                                placeholder="30 5 * * 1-5"
                                aria-label={`Cron schedule for ${rule.name}`}
                                className={`min-w-[170px] flex-1 rounded-lg border bg-slate-900 px-3 py-1.5 font-mono text-xs tabular-nums text-white placeholder-slate-500 focus:outline-none ${
                                  !cronValidation.valid
                                    ? 'border-rose-500/70 focus:border-rose-400'
                                    : isCronDirty
                                      ? 'border-amber-500/70 focus:border-amber-400'
                                      : 'border-slate-700 focus:border-amber-500'
                                }`}
                              />

                              {isCronDirty && onUpdateAutopilot && (
                                <>
                                  <button
                                    type="button"
                                    disabled={!cronValidation.valid || isSavingCron}
                                    onClick={() => void saveInlineCronSchedule()}
                                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    {isSavingCron ? (
                                      <>
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Saving...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Check className="h-3.5 w-3.5" />
                                        <span>Save Schedule</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSavingCron}
                                    onClick={() =>
                                      setCronEdits((prev) => {
                                        const next = { ...prev };
                                        delete next[rule.id];
                                        return next;
                                      })
                                    }
                                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Reset
                                  </button>
                                </>
                              )}
                            </div>

                            {onUpdateAutopilot && (
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="text-[10px] text-slate-500 mr-0.5">
                                    Presets:
                                  </span>
                                  {(
                                    [
                                      ['30 5 * * 1-5', '07:30 SAST Wkd'],
                                      ['30 10 * * 1-5', '12:30 SAST Wkd'],
                                      ['0 15 * * 1-5', '17:00 SAST Wkd'],
                                      ['0 6 * * 1', 'Mon 08:00 SAST'],
                                      ['0 */2 * * 1-5', 'Every 2h Wkd'],
                                    ] as const
                                  ).map(([presetCron, presetLabel]) => {
                                    const isCurrent = currentCronInput.trim() === presetCron;
                                    return (
                                      <button
                                        key={presetCron}
                                        type="button"
                                        onClick={() =>
                                          setCronEdits((prev) => ({
                                            ...prev,
                                            [rule.id]: presetCron,
                                          }))
                                        }
                                        className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                          isCurrent
                                            ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                                            : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                                        }`}
                                      >
                                        {presetLabel}
                                      </button>
                                    );
                                  })}
                                </div>

                                <button
                                  type="button"
                                  onClick={toggleScopeEditor}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  <span>Scope &amp; Filters</span>
                                  {isExpanded ? (
                                    <ChevronUp className="h-3 w-3" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
                            <span className="font-mono text-slate-400">
                              Trigger: POST /api/webhooks/workspace · Raw HMAC / OIDC verified
                            </span>
                            <button
                              type="button"
                              onClick={toggleScopeEditor}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <span>Scope &amp; Monitored Labels</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        )}

                        {/* Monitored Scope Summary (when collapsed) */}
                        {((rule.config.monitored_gmail_labels?.length ?? 0) > 0 ||
                          (rule.config.watched_chat_spaces?.length ?? 0) > 0) &&
                          !isExpanded && (
                            <div className="text-[11px] text-slate-400 space-y-0.5">
                              {(rule.config.monitored_gmail_labels?.length ?? 0) > 0 && (
                                <p className="truncate">
                                  <span className="text-slate-500">Gmail labels: </span>
                                  {rule.config.monitored_gmail_labels!.join(' · ')}
                                </p>
                              )}
                              {(rule.config.watched_chat_spaces?.length ?? 0) > 0 && (
                                <p className="truncate">
                                  <span className="text-slate-500">Watched Chat spaces: </span>
                                  {rule.config.watched_chat_spaces!.join(' · ')}
                                </p>
                              )}
                            </div>
                          )}

                        {/* Latest Test / Scheduled Run Inline Status */}
                        {latestRunForRule && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 pt-2 text-[11px] text-slate-400 tabular-nums">
                            <div className="min-w-0 flex-1 truncate">
                              <span className="text-slate-500">Latest run: </span>
                              <span
                                className={
                                  latestRunForRule.status === 'staged_packet'
                                    ? 'text-amber-300 font-medium'
                                    : latestRunForRule.status === 'completed'
                                      ? 'text-emerald-400 font-medium'
                                      : latestRunForRule.status === 'failed_closed'
                                        ? 'text-rose-400 font-medium'
                                        : 'text-slate-400'
                                }
                              >
                                {latestRunForRule.status === 'staged_packet'
                                  ? `Staged ${latestRunForRule.staged_packet_ids.length} packet(s)`
                                  : latestRunForRule.status}
                              </span>
                              <span className="text-slate-600" aria-hidden="true"> · </span>
                              <span className="font-mono">{latestRunForRule.duration_ms}ms</span>
                              <span className="text-slate-600" aria-hidden="true"> · </span>
                              <span className="text-slate-300">{latestRunForRule.summary}</span>
                            </div>

                            {latestRunForRule.staged_packet_ids.length > 0 && onOpenApprovals && (
                              <button
                                type="button"
                                onClick={onOpenApprovals}
                                className="font-semibold text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Review Packet
                              </button>
                            )}
                          </div>
                        )}

                        {/* Expandable Rule Scope, House Routing & Label Filters */}
                        {isExpanded && onUpdateAutopilot && (
                          <div className="border-t border-slate-800 pt-3 space-y-3 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div>
                                <label className="block text-[11px] text-slate-400 mb-1">
                                  Target House Director
                                </label>
                                <select
                                  value={draft.target_house}
                                  onChange={(e) =>
                                    setRuleDrafts((prev) => ({
                                      ...prev,
                                      [rule.id]: { ...draft, target_house: e.target.value },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                >
                                  <option value="daniel">Daniel (Workspace &amp; Comms)</option>
                                  <option value="devon">Devon (Operations &amp; SOPs)</option>
                                  <option value="aria">Aria (Research &amp; Intel)</option>
                                  <option value="kieran">Kieran (Systems &amp; Engineering)</option>
                                  <option value="marcus">Marcus (Finance &amp; Treasury)</option>
                                  <option value="layla">Layla (Brand &amp; Briefings)</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] text-slate-400 mb-1">
                                  Decision Packet TTL (hours)
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={168}
                                  value={draft.packet_ttl_hours}
                                  onChange={(e) =>
                                    setRuleDrafts((prev) => ({
                                      ...prev,
                                      [rule.id]: {
                                        ...draft,
                                        packet_ttl_hours: Number(e.target.value) || 24,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono tabular-nums text-white focus:border-amber-500 focus:outline-none"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Monitored Gmail Labels (comma-separated, per KB-SOP-06)
                              </label>
                              <input
                                type="text"
                                value={draft.monitored_gmail_labels_text}
                                onChange={(e) =>
                                  setRuleDrafts((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...draft,
                                      monitored_gmail_labels_text: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="INBOX_PRIORITY, Meeting Notes, CS Insights"
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                              />
                              {mergedGmailLabels.filter((l) => l.type === 'user').length > 0 && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                  <span className="text-[10px] text-slate-500">Quick toggle:</span>
                                  {mergedGmailLabels
                                    .filter((l) => l.type === 'user')
                                    .slice(0, 8)
                                    .map((lbl) => {
                                      const currentList = draft.monitored_gmail_labels_text
                                        .split(',')
                                        .map((s) => s.trim())
                                        .filter(Boolean);
                                      const active = currentList.some(
                                        (s) => s.toLowerCase() === lbl.name.toLowerCase()
                                      );
                                      return (
                                        <button
                                          key={lbl.id}
                                          type="button"
                                          onClick={() => {
                                            const nextList = active
                                              ? currentList.filter(
                                                  (s) => s.toLowerCase() !== lbl.name.toLowerCase()
                                                )
                                              : [...currentList, lbl.name];
                                            setRuleDrafts((prev) => ({
                                              ...prev,
                                              [rule.id]: {
                                                ...draft,
                                                monitored_gmail_labels_text: nextList.join(', '),
                                              },
                                            }));
                                          }}
                                          className={`rounded border px-2 py-0.5 text-[10px] font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                                            active
                                              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                                              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                                          }`}
                                        >
                                          {lbl.name}
                                        </button>
                                      );
                                    })}
                                </div>
                              )}
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Watched Google Chat Spaces (comma-separated names or spaces/IDs)
                              </label>
                              <input
                                type="text"
                                value={draft.watched_chat_spaces_text}
                                onChange={(e) =>
                                  setRuleDrafts((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...draft,
                                      watched_chat_spaces_text: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Product Operations, Backend, Integration, spaces/AAAA..."
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                              />
                            </div>

                            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={draft.ignore_unread_bulk}
                                onChange={(e) =>
                                  setRuleDrafts((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...draft,
                                      ignore_unread_bulk: e.target.checked,
                                    },
                                  }))
                                }
                                className="rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-0"
                              />
                              <span>Ignore bulk unread newsletters and promotional inbox noise</span>
                            </label>

                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setExpandedRuleId(null)}
                                className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={savingRuleId === rule.id}
                                onClick={async () => {
                                  const pendingCron = (cronEdits[rule.id] ?? savedCron).trim();
                                  if (rule.type === 'cron') {
                                    const check = validateCronExpression(pendingCron);
                                    if (!check.valid) {
                                      setStatusMessage({
                                        tone: 'error',
                                        text: check.error || 'Invalid cron schedule.',
                                      });
                                      return;
                                    }
                                  }
                                  setSavingRuleId(rule.id);
                                  setStatusMessage(null);
                                  try {
                                    await onUpdateAutopilot({
                                      rule_update: {
                                        id: rule.id,
                                        ...(rule.type === 'cron'
                                          ? { schedule_cron: pendingCron }
                                          : {}),
                                        target_house: draft.target_house,
                                        config: {
                                          monitored_gmail_labels: draft.monitored_gmail_labels_text
                                            .split(',')
                                            .map((s) => s.trim())
                                            .filter(Boolean),
                                          ignore_unread_bulk: draft.ignore_unread_bulk,
                                          watched_chat_spaces: draft.watched_chat_spaces_text
                                            .split(',')
                                            .map((s) => s.trim())
                                            .filter(Boolean),
                                          packet_ttl_hours: draft.packet_ttl_hours,
                                        },
                                      },
                                    });
                                    setCronEdits((prev) => {
                                      const next = { ...prev };
                                      delete next[rule.id];
                                      return next;
                                    });
                                    setExpandedRuleId(null);
                                    setStatusMessage({
                                      tone: 'ok',
                                      text: `Saved configuration for "${rule.name}".`,
                                    });
                                  } catch (err) {
                                    setStatusMessage({
                                      tone: 'error',
                                      text:
                                        err instanceof Error
                                          ? err.message
                                          : 'Failed to save rule configuration.',
                                    });
                                  } finally {
                                    setSavingRuleId(null);
                                  }
                                }}
                                className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                {savingRuleId === rule.id ? 'Saving...' : 'Save Scope & Filters'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>

            {/* Recent Town Digest Stream */}
            <section className="rounded-xl border border-slate-800 bg-slate-950/75 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-white tabular-nums">
                  Recent Town Digest ({automationRuns.length})
                </h4>
                <div className="flex items-center gap-3 shrink-0">
                  {onOpenApprovals && (
                    <button
                      type="button"
                      onClick={onOpenApprovals}
                      className="text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Pending Approvals
                    </button>
                  )}
                  {onOpenDigest && (
                    <button
                      type="button"
                      onClick={onOpenDigest}
                      className="text-[11px] font-medium text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Open Full Digest
                    </button>
                  )}
                </div>
              </div>

              {automationRuns.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No background runs recorded yet. Click &ldquo;Test Run Now&rdquo; on any rule above to test the headless KB-SOP-01 pipeline.
                </p>
              ) : (
                <div className="divide-y divide-slate-800">
                  {automationRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="py-2 first:pt-0 last:pb-0 space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                        <span className="font-medium text-slate-200 truncate">
                          {run.rule_name || run.rule_id} ·{' '}
                          <span
                            className={
                              run.status === 'staged_packet'
                                ? 'text-amber-300'
                                : run.status === 'completed'
                                  ? 'text-emerald-400'
                                  : run.status === 'failed_closed'
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                            }
                          >
                            {run.status}
                          </span>{' '}
                          · {run.duration_ms}ms
                        </span>
                        <span className="shrink-0 text-slate-500">
                          {formatShortDate(run.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2">{run.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : activeTab === 'audio' ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-amber-400 shrink-0" />
                <h3 className="text-sm font-semibold text-white">Voice &amp; Audio</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Control spoken villager replies and subtle UI sound cues across the command console.
              </p>
            </div>

            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/70">
              <div className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-xs font-semibold text-white">Auto-Speak Agent Replies</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Automatically read delivered task summaries and direct replies aloud in each Director&apos;s chosen voice.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => voicePlayer.setAutoSpeakReplies(!voiceState.autoSpeakReplies)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    voiceState.autoSpeakReplies
                      ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {voiceState.autoSpeakReplies ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-xs font-semibold text-white">Interface Sound Effects</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Chimes for task dispatch, report completion, and chat replies.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onToggleSound}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    soundEnabled
                      ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {soundEnabled ? 'Enabled' : 'Muted'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Grid className="h-4 w-4 text-sky-400 shrink-0" />
                <h3 className="text-sm font-semibold text-white">Map &amp; Display</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Adjust map overlays, 4K diorama rendering, onboarding guide visibility, and keyboard shortcuts.
              </p>
            </div>

            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/70">
              <div className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-xs font-semibold text-white">Show Walkability Paths Overlay</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Toggle the pathfinding tile grid over the village square (Shortcut: G).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onToggleWalkability}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    showWalkability
                      ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {showWalkability ? 'Visible' : 'Hidden'}
                </button>
              </div>

              {onRender4kMap && (
                <div className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="text-xs font-semibold text-white">4K Village Diorama Map</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {map4kActive
                        ? 'High-resolution 4K diorama texture is currently active.'
                        : 'Render or upgrade the high-resolution 4K village diorama map.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onRender4kMap}
                    disabled={isRendering4k}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      {isRendering4k ? 'Rendering...' : map4kActive ? 'Re-render 4K' : 'Upgrade 4K'}
                    </span>
                  </button>
                </div>
              )}

              {onShowQuickGuide && (
                <div className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="text-xs font-semibold text-white">Map Quick-Start Guide</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {settings.hasDismissedQuickGuide
                        ? 'Restore the 3-step onboarding strip at the top of the village map.'
                        : 'Currently shown above the village map until dismissed.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!settings.hasDismissedQuickGuide}
                    onClick={() => {
                      onShowQuickGuide();
                      setStatusMessage({
                        tone: 'ok',
                        text: 'Restored the Quick-Start Guide strip on the village map.',
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
                    <span>{settings.hasDismissedQuickGuide ? 'Show Quick-Start Guide' : 'Visible on Map'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <p className="text-[11px] text-slate-400">Active Villagers</p>
                <p className="mt-1 text-lg font-bold text-white tabular-nums">{agentCount}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <p className="text-[11px] text-slate-400">Tracked Tasks</p>
                <p className="mt-1 text-lg font-bold text-white tabular-nums">{taskCount}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <p className="text-[11px] text-slate-400">Knowledge Entries</p>
                <p className="mt-1 text-lg font-bold text-white tabular-nums">{knowledgeCount}</p>
              </div>
            </div>

            {/* Keyboard Shortcuts Reference */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-amber-400 shrink-0" />
                <h4 className="text-xs font-semibold text-white">Keyboard Shortcuts</h4>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                {KEYBOARD_SHORTCUTS.map((sc) => (
                  <div
                    key={sc.keys}
                    className="flex items-center justify-between gap-2 text-[11px] border-b border-slate-800/60 pb-1.5"
                  >
                    <span className="text-slate-400 truncate">{sc.action}</span>
                    <kbd className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300 whitespace-nowrap shrink-0">
                      {sc.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
