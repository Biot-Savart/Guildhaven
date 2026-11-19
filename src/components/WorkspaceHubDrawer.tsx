import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderCheck,
  FolderPlus,
  HardDrive,
  Link2,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  MessagesSquare,
  PencilLine,
  Pin,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import guildhavenAvatarImg from '../assets/images/guildhaven_chat_avatar_1794833257258.jpg';
import { ensureWorkspaceToken } from '../lib/googleAuth';
import { SpeakButton } from './SpeakButton';
import type { ReadOnlyExternalError } from './SettingsDrawer';
import type {
  Agent,
  CalendarEventSummary,
  ChatSpaceSummary,
  DriveWorkingFolderConfig,
  GmailLabelConfig,
  GmailLabelSummary,
  GmailSummary,
  GoogleChatMessageSummary,
  GoogleChatThreadSummary,
  GoogleDriveFileSummary,
  PinnedChatContext,
  WorkspaceBriefing,
} from '../types/village';

export type WorkspaceTab = 'overview' | 'calendar' | 'chat' | 'docs' | 'drive';

interface BreadcrumbNode {
  id: string;
  name: string;
}

const CALENDAR_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatCalendarTimestamp(iso?: string): string {
  if (!iso) return '';
  const trimmed = iso.trim();
  if (!trimmed) return '';
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    const monthName = CALENDAR_MONTHS[Number(m) - 1] ?? m;
    return `${monthName} ${Number(d)}, ${y} (All day)`;
  }
  const explicitMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.exec(
      trimmed
    );
  if (explicitMatch) {
    const [, , m, d, hm, tz] = explicitMatch;
    const monthName = CALENDAR_MONTHS[Number(m) - 1] ?? m;
    const tzLabel = tz.toUpperCase() === 'Z' ? 'UTC' : tz;
    return `${monthName} ${Number(d)}, ${hm} (${tzLabel})`;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return trimmed;
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalDateTimeInput(iso?: string, offsetMinutes = 0): string {
  const base = iso ? new Date(iso) : new Date(Date.now() + offsetMinutes * 60 * 1000);
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date(Date.now() + offsetMinutes * 60 * 1000);
    return toLocalDateTimeInput(fallback.toISOString(), 0);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(
    base.getHours()
  )}:${pad(base.getMinutes())}`;
}

function toLocalIsoWithOffset(localDateTime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    localDateTime.trim()
  );
  if (!match) {
    const d = new Date(localDateTime);
    return Number.isNaN(d.getTime()) ? localDateTime : d.toISOString();
  }
  const [, y, mo, d, h, mi, s = '00'] = match;
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offsetMins = -parsed.getTimezoneOffset();
  const sign = offsetMins >= 0 ? '+' : '-';
  const absMins = Math.abs(offsetMins);
  const hh = String(Math.floor(absMins / 60)).padStart(2, '0');
  const mm = String(absMins % 60).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
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

function formatFileSize(sizeStr?: string): string {
  if (!sizeStr) return '';
  const bytes = Number(sizeStr);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseSearchKeywords(raw: string): string[] {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return [];
  return Array.from(new Set(trimmed.split(/\s+/).filter(Boolean)));
}

function matchesChatKeyword(msg: GoogleChatMessageSummary, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const textLower = msg.text.toLowerCase();
  const senderLower = msg.senderName.toLowerCase();
  const attachmentsLower = (msg.attachmentNames ?? []).map((a) => a.toLowerCase());
  const reactionsLower = (msg.reactionSummary ?? []).map((r) => r.toLowerCase());
  return keywords.every(
    (kw) =>
      textLower.includes(kw) ||
      senderLower.includes(kw) ||
      attachmentsLower.some((a) => a.includes(kw)) ||
      reactionsLower.some((r) => r.includes(kw))
  );
}

function renderHighlightedText(text: string, rawQuery: string): React.ReactNode {
  if (!text) return text;
  const keywords = parseSearchKeywords(rawQuery);
  if (keywords.length === 0) return text;
  const escaped = keywords
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length <= 1) return text;
  const keywordSet = new Set(keywords);
  return parts.map((part, idx) =>
    keywordSet.has(part.toLowerCase()) ? (
      <mark key={idx} className="rounded-sm bg-amber-400/30 px-0.5 text-amber-100">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

interface WorkspaceHubDrawerProps {
  initialTab?: WorkspaceTab;
  agents: Agent[];
  workspaceBriefing: WorkspaceBriefing;
  workingFolder?: DriveWorkingFolderConfig | null;
  calendarWriteAccess?: boolean;
  gmailIncludeInbox?: boolean;
  gmailSelectedLabels?: GmailLabelConfig[];
  isGoogleConnected: boolean;
  onSyncWorkspace: () => Promise<void>;
  onGoogleSignIn: () => void;
  onGrantWorkspaceConsent: () => Promise<void>;
  onGrantCalendarWriteConsent: () => Promise<void>;
  onEnableCalendarWriteAccess?: () => void;
  onUpdateGmailSources?: (next: {
    includeInbox: boolean;
    selectedLabels: GmailLabelConfig[];
  }) => void;
  onListGmailLabels?: () => Promise<GmailLabelSummary[]>;
  onReadGmailMessages?: (params: {
    labelIds?: string[];
    includeInbox?: boolean;
    query?: string;
    unreadOnly?: boolean;
    maxResults?: number;
    includeBody?: boolean;
  }) => Promise<{ messages: GmailSummary[]; matchedLabels: GmailLabelSummary[] }>;
  onCreateCalendarEvent?: (params: {
    summary: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
  }) => Promise<CalendarEventSummary>;
  onUpdateCalendarEvent?: (
    eventId: string,
    params: {
      summary?: string;
      start?: string;
      end?: string;
      location?: string;
      description?: string;
    }
  ) => Promise<CalendarEventSummary>;
  onDeleteCalendarEvent?: (eventId: string) => Promise<void>;
  onSendChatMessage: (spaceName: string, text: string, threadName?: string) => Promise<void>;
  onListChatSpaces?: (params?: {
    pageToken?: string;
    filterType?: 'ALL' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  }) => Promise<{ spaces: ChatSpaceSummary[]; nextPageToken?: string }>;
  onReadChatConversation?: (params: {
    target: string;
    threadName?: string;
    pageSize?: number;
    pageToken?: string;
    searchQuery?: string;
  }) => Promise<{
    space: ChatSpaceSummary;
    messages: GoogleChatMessageSummary[];
    threads: GoogleChatThreadSummary[];
    focusedThreadName?: string;
    nextPageToken?: string;
  }>;
  onPinChatContext?: (params: {
    target?: string;
    spaceName: string;
    spaceDisplayName: string;
    spaceType?: string;
    threadName?: string;
    label?: string;
    messages: GoogleChatMessageSummary[];
  }) => Promise<PinnedChatContext[]>;
  onUnpinChatContext?: (id: string) => Promise<PinnedChatContext[]>;
  onImportGoogleDoc: (docIdOrUrl: string) => Promise<void>;
  onCreateGoogleDoc: (title: string, content: string) => Promise<{ url: string; title: string }>;
  onUnlinkGoogleDoc: (documentId: string) => Promise<void>;
  onSearchDriveFiles: (query?: string, folderId?: string) => Promise<GoogleDriveFileSummary[]>;
  onPinDriveFile: (fileIdOrUrl: string) => Promise<void>;
  onUnpinDriveFile: (fileId: string) => Promise<void>;
  onSaveDriveFile: (params: {
    name: string;
    content?: string;
    isFolder?: boolean;
    parentFolderId?: string;
  }) => Promise<{ url: string; name: string }>;
  onListWorkingFolderFiles: (folderId?: string, query?: string) => Promise<GoogleDriveFileSummary[]>;
  onReadWorkingFolderFile: (fileId: string) => Promise<GoogleDriveFileSummary>;
  onCreateWorkingFolderItem: (params: {
    name: string;
    content?: string;
    isFolder?: boolean;
    parentFolderId?: string;
  }) => Promise<GoogleDriveFileSummary>;
  onUpdateWorkingFolderFile: (params: {
    fileId: string;
    name?: string;
    content?: string;
  }) => Promise<GoogleDriveFileSummary>;
  onTrashWorkingFolderFile: (fileId: string) => Promise<void>;
  onOpenSettings: (tab?: 'guardrails' | 'audio' | 'village') => void;
  onOpenAgentChat?: (agent: Agent) => void;
  onAskDanielWithPrompt?: (prompt: string) => void;
  onPrefillTask?: (prompt: string) => void;
  onOpenMorningBriefing?: () => void;
  onClose: () => void;
}

export const WorkspaceHubDrawer: React.FC<WorkspaceHubDrawerProps> = ({
  initialTab = 'overview',
  agents,
  workspaceBriefing,
  workingFolder = null,
  calendarWriteAccess = false,
  gmailIncludeInbox = true,
  gmailSelectedLabels = [],
  isGoogleConnected,
  onSyncWorkspace,
  onGoogleSignIn,
  onGrantWorkspaceConsent,
  onGrantCalendarWriteConsent,
  onEnableCalendarWriteAccess,
  onUpdateGmailSources,
  onListGmailLabels,
  onReadGmailMessages,
  onCreateCalendarEvent,
  onUpdateCalendarEvent,
  onDeleteCalendarEvent,
  onSendChatMessage,
  onListChatSpaces,
  onReadChatConversation,
  onPinChatContext,
  onUnpinChatContext,
  onImportGoogleDoc,
  onCreateGoogleDoc,
  onUnlinkGoogleDoc,
  onSearchDriveFiles,
  onPinDriveFile,
  onUnpinDriveFile,
  onSaveDriveFile,
  onListWorkingFolderFiles,
  onReadWorkingFolderFile,
  onCreateWorkingFolderItem,
  onUpdateWorkingFolderFile,
  onTrashWorkingFolderFile,
  onOpenSettings,
  onOpenAgentChat,
  onAskDanielWithPrompt,
  onPrefillTask,
  onOpenMorningBriefing,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [workspaceNotice, setWorkspaceNotice] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Gmail labels & source filtering state
  const [showGmailLabelConfig, setShowGmailLabelConfig] = useState(false);
  const [gmailCatalogLabels, setGmailCatalogLabels] = useState<GmailLabelSummary[]>([]);
  const [isLoadingGmailLabels, setIsLoadingGmailLabels] = useState(false);
  const [gmailLabelFilterInput, setGmailLabelFilterInput] = useState('');
  const [activeGmailFilterId, setActiveGmailFilterId] = useState<string>('ALL_MONITORED');
  const [gmailUnreadOnly, setGmailUnreadOnly] = useState(false);
  const [gmailSearchInput, setGmailSearchInput] = useState('');
  const [customFetchedEmails, setCustomFetchedEmails] = useState<GmailSummary[] | null>(null);
  const [isLoadingCustomEmails, setIsLoadingCustomEmails] = useState(false);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const danielAgent = agents.find((a) => a.id === 'daniel');
  const chatSpaces = workspaceBriefing.chatSpaces ?? [];
  const pinnedChats = workspaceBriefing.pinnedChats ?? [];
  const linkedDocs = workspaceBriefing.linkedDocs ?? [];
  const driveFiles = workspaceBriefing.driveFiles ?? [];
  const pinnedDriveFiles = workspaceBriefing.pinnedDriveFiles ?? [];

  // Merge briefing labels with any detailed label catalog fetched on demand
  const mergedGmailLabels = React.useMemo(() => {
    const map = new Map<string, GmailLabelSummary>();
    for (const l of workspaceBriefing.gmailLabels ?? []) {
      map.set(l.id, l);
    }
    for (const l of workspaceBriefing.activeGmailSources ?? []) {
      map.set(l.id, { ...(map.get(l.id) ?? l), ...l });
    }
    for (const l of gmailCatalogLabels) {
      map.set(l.id, { ...(map.get(l.id) ?? l), ...l });
    }
    return Array.from(map.values());
  }, [gmailCatalogLabels, workspaceBriefing.activeGmailSources, workspaceBriefing.gmailLabels]);

  const refreshGmailLabelsCatalog = useCallback(async () => {
    if (!isGoogleConnected || !onListGmailLabels) return;
    setIsLoadingGmailLabels(true);
    try {
      const list = await onListGmailLabels();
      setGmailCatalogLabels(list);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to load Gmail labels.',
      });
    } finally {
      setIsLoadingGmailLabels(false);
    }
  }, [isGoogleConnected, onListGmailLabels]);

  useEffect(() => {
    if (showGmailLabelConfig && isGoogleConnected && gmailCatalogLabels.length === 0) {
      void refreshGmailLabelsCatalog();
    }
  }, [gmailCatalogLabels.length, isGoogleConnected, refreshGmailLabelsCatalog, showGmailLabelConfig]);

  // Reset active filter tab if the user removes that label or unchecks Inbox
  useEffect(() => {
    if (activeGmailFilterId === 'INBOX' && !gmailIncludeInbox) {
      setActiveGmailFilterId('ALL_MONITORED');
      setCustomFetchedEmails(null);
      return;
    }
    if (
      activeGmailFilterId !== 'ALL_MONITORED' &&
      activeGmailFilterId !== 'INBOX' &&
      !gmailSelectedLabels.some((l) => l.id === activeGmailFilterId)
    ) {
      setActiveGmailFilterId('ALL_MONITORED');
      setCustomFetchedEmails(null);
    }
  }, [activeGmailFilterId, gmailIncludeInbox, gmailSelectedLabels]);

  const loadFilteredGmailMessages = useCallback(
    async (opts?: {
      filterId?: string;
      unreadOnly?: boolean;
      query?: string;
    }) => {
      if (!isGoogleConnected || !onReadGmailMessages) return;
      const targetFilter = opts?.filterId ?? activeGmailFilterId;
      const targetUnread = opts?.unreadOnly ?? gmailUnreadOnly;
      const targetQuery = (opts?.query ?? gmailSearchInput).trim();

      if (targetFilter === 'ALL_MONITORED' && !targetUnread && !targetQuery) {
        setCustomFetchedEmails(null);
        return;
      }

      const targetLabelIds: string[] = [];
      let includeInbox = false;
      if (targetFilter === 'ALL_MONITORED') {
        includeInbox = gmailIncludeInbox;
        for (const l of gmailSelectedLabels) {
          targetLabelIds.push(l.id);
        }
      } else if (targetFilter === 'INBOX') {
        includeInbox = true;
      } else {
        targetLabelIds.push(targetFilter);
      }

      if (!includeInbox && targetLabelIds.length === 0 && !targetQuery) {
        setCustomFetchedEmails([]);
        return;
      }

      setIsLoadingCustomEmails(true);
      try {
        const res = await onReadGmailMessages({
          labelIds: targetLabelIds,
          includeInbox,
          query: targetQuery || undefined,
          unreadOnly: targetUnread,
          maxResults: 20,
          includeBody: true,
        });
        setCustomFetchedEmails(res.messages);
      } catch (err) {
        setWorkspaceNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Unable to load Gmail messages for this filter.',
        });
      } finally {
        setIsLoadingCustomEmails(false);
      }
    },
    [
      activeGmailFilterId,
      gmailIncludeInbox,
      gmailSearchInput,
      gmailSelectedLabels,
      gmailUnreadOnly,
      isGoogleConnected,
      onReadGmailMessages,
    ]
  );

  const handleToggleIncludeInbox = () => {
    if (!onUpdateGmailSources) return;
    const nextInclude = !gmailIncludeInbox;
    onUpdateGmailSources({
      includeInbox: nextInclude,
      selectedLabels: gmailSelectedLabels,
    });
    setCustomFetchedEmails(null);
  };

  const handleToggleGmailLabel = (lbl: GmailLabelSummary | GmailLabelConfig) => {
    if (!onUpdateGmailSources) return;
    if (lbl.id === 'INBOX') {
      handleToggleIncludeInbox();
      return;
    }
    const exists = gmailSelectedLabels.some((item) => item.id === lbl.id);
    const nextLabels = exists
      ? gmailSelectedLabels.filter((item) => item.id !== lbl.id)
      : [
          ...gmailSelectedLabels,
          { id: lbl.id, name: lbl.name, ...(lbl.type ? { type: lbl.type } : {}) },
        ];
    onUpdateGmailSources({
      includeInbox: gmailIncludeInbox,
      selectedLabels: nextLabels,
    });
    setCustomFetchedEmails(null);
  };

  // Calendar state
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [editingCalendarEventId, setEditingCalendarEventId] = useState<string | null>(null);
  const [calSummary, setCalSummary] = useState('');
  const [calStart, setCalStart] = useState(() => toLocalDateTimeInput(undefined, 60));
  const [calEnd, setCalEnd] = useState(() => toLocalDateTimeInput(undefined, 90));
  const [calLocation, setCalLocation] = useState('');
  const [calDescription, setCalDescription] = useState('');
  const [pendingCalendarConfirm, setPendingCalendarConfirm] = useState<{
    action: 'create' | 'update' | 'delete';
    eventId?: string;
    summary: string;
    start?: string;
    end?: string;
    location?: string;
    description?: string;
  } | null>(null);
  const [isMutatingCalendar, setIsMutatingCalendar] = useState(false);
  const [isGrantingCalendar, setIsGrantingCalendar] = useState(false);

  // Google Chat Workbench state
  const [selectedSpaceName, setSelectedSpaceName] = useState<string>(chatSpaces[0]?.name ?? '');
  const [extraSpaces, setExtraSpaces] = useState<ChatSpaceSummary[]>([]);
  const [isLoadingSpacesList, setIsLoadingSpacesList] = useState(false);
  const [spaceFilterMode, setSpaceFilterMode] = useState<'all' | 'spaces' | 'dms' | 'pinned'>('all');
  const [spaceSearchQuery, setSpaceSearchQuery] = useState('');
  const [showSpaceDirectory, setShowSpaceDirectory] = useState(true);
  const [chatTargetInput, setChatTargetInput] = useState('');

  const [activeChatSpace, setActiveChatSpace] = useState<ChatSpaceSummary | null>(null);
  const [loadedMessages, setLoadedMessages] = useState<GoogleChatMessageSummary[]>([]);
  const [loadedThreads, setLoadedThreads] = useState<GoogleChatThreadSummary[]>([]);
  const [focusedThreadName, setFocusedThreadName] = useState<string | null>(null);
  const [chatViewMode, setChatViewMode] = useState<'messages' | 'threads'>('messages');
  const [chatMessageFilter, setChatMessageFilter] = useState('');
  const [chatNextPageToken, setChatNextPageToken] = useState<string | null>(null);
  const [isLoadingChatRead, setIsLoadingChatRead] = useState(false);
  const [isLoadingOlderChat, setIsLoadingOlderChat] = useState(false);
  const [pinningChatKey, setPinningChatKey] = useState<string | null>(null);

  const [replyThreadName, setReplyThreadName] = useState<string | null>(null);
  const [chatMessageDraft, setChatMessageDraft] = useState('');
  const [pendingChatConfirm, setPendingChatConfirm] = useState<{
    spaceName: string;
    spaceLabel: string;
    threadName?: string;
    text: string;
  } | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [showChatAppSetup, setShowChatAppSetup] = useState(false);
  const [publishedChatAvatarUrl, setPublishedChatAvatarUrl] = useState<string | null>(null);
  const [isPublishingAvatar, setIsPublishingAvatar] = useState(false);

  // Merge synced chatSpaces + any extra fetched spaces without duplicates
  const allKnownSpaces = React.useMemo(() => {
    const byName = new Map<string, ChatSpaceSummary>();
    for (const sp of chatSpaces) {
      if (sp?.name) byName.set(sp.name, sp);
    }
    for (const sp of extraSpaces) {
      if (sp?.name && !byName.has(sp.name)) {
        byName.set(sp.name, sp);
      }
    }
    if (activeChatSpace?.name && !byName.has(activeChatSpace.name)) {
      byName.set(activeChatSpace.name, activeChatSpace);
    }
    return Array.from(byName.values());
  }, [chatSpaces, extraSpaces, activeChatSpace]);

  useEffect(() => {
    if (!selectedSpaceName && allKnownSpaces.length > 0) {
      setSelectedSpaceName(allKnownSpaces[0].name);
    }
  }, [allKnownSpaces, selectedSpaceName]);

  // Google Docs state
  const [docUrlInput, setDocUrlInput] = useState('');
  const [isImportingDoc, setIsImportingDoc] = useState(false);
  const [showNewDocForm, setShowNewDocForm] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocBody, setNewDocBody] = useState('');
  const [pendingDocConfirm, setPendingDocConfirm] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [isCreatingDoc, setIsCreatingDoc] = useState(false);

  // Working Folder Explorer state
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbNode[]>(() =>
    workingFolder ? [{ id: workingFolder.id, name: workingFolder.name }] : []
  );
  const [folderItems, setFolderItems] = useState<GoogleDriveFileSummary[]>(
    workspaceBriefing.workingFolderFiles ?? []
  );
  const [explorerQuery, setExplorerQuery] = useState('');
  const [isLoadingExplorer, setIsLoadingExplorer] = useState(false);
  const [showCreateWorkingForm, setShowCreateWorkingForm] = useState<'none' | 'file' | 'folder'>('none');
  const [newItemName, setNewItemName] = useState('');
  const [newItemContent, setNewItemContent] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [selectedFile, setSelectedFile] = useState<GoogleDriveFileSummary | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [readOnlyExternalNotice, setReadOnlyExternalNotice] = useState<string | null>(null);
  const [isCopyingEditable, setIsCopyingEditable] = useState(false);
  const [pendingTrashItem, setPendingTrashItem] = useState<GoogleDriveFileSummary | null>(null);
  const [isTrashing, setIsTrashing] = useState(false);

  // Global Drive search & pinning state
  const [driveSearchInput, setDriveSearchInput] = useState('');
  const [driveSearchResults, setDriveSearchResults] = useState<GoogleDriveFileSummary[] | null>(null);
  const [activeDriveFolderName, setActiveDriveFolderName] = useState<string | null>(null);
  const [activeDriveFolderId, setActiveDriveFolderId] = useState<string | null>(null);
  const [isSearchingDrive, setIsSearchingDrive] = useState(false);
  const [pinningDriveId, setPinningDriveId] = useState<string | null>(null);
  const [showNewDriveForm, setShowNewDriveForm] = useState(false);
  const [newDriveIsFolder, setNewDriveIsFolder] = useState(false);
  const [newDriveName, setNewDriveName] = useState('');
  const [newDriveContent, setNewDriveContent] = useState('');
  const [pendingDriveConfirm, setPendingDriveConfirm] = useState<{
    name: string;
    content: string;
    isFolder: boolean;
    parentFolderId?: string;
    parentFolderName?: string | null;
  } | null>(null);
  const [isSavingDrive, setIsSavingDrive] = useState(false);

  const currentExplorerFolderId =
    breadcrumbs[breadcrumbs.length - 1]?.id ?? workingFolder?.id ?? undefined;

  useEffect(() => {
    if (workingFolder) {
      setBreadcrumbs((prev) =>
        prev.length > 0 && prev[0].id === workingFolder.id
          ? prev
          : [{ id: workingFolder.id, name: workingFolder.name }]
      );
    } else {
      setBreadcrumbs([]);
      setFolderItems([]);
      setSelectedFile(null);
    }
  }, [workingFolder?.id, workingFolder?.name]);

  const loadExplorerItems = useCallback(
    async (folderId?: string, query?: string) => {
      if (!isGoogleConnected || !workingFolder) return;
      setIsLoadingExplorer(true);
      try {
        const list = await onListWorkingFolderFiles(folderId ?? workingFolder.id, query);
        setFolderItems(list);
      } catch (err) {
        setWorkspaceNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Unable to load Working Folder contents.',
        });
      } finally {
        setIsLoadingExplorer(false);
      }
    },
    [isGoogleConnected, onListWorkingFolderFiles, workingFolder]
  );

  useEffect(() => {
    if (activeTab === 'drive' && isGoogleConnected && workingFolder) {
      void loadExplorerItems(currentExplorerFolderId, explorerQuery);
    }
  }, [activeTab, isGoogleConnected, workingFolder?.id, currentExplorerFolderId]);

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      await onSyncWorkspace();
    } finally {
      setIsSyncing(false);
    }
  };

  // Calendar actions
  const openNewCalendarEventForm = () => {
    setEditingCalendarEventId(null);
    setCalSummary('');
    setCalStart(toLocalDateTimeInput(undefined, 60));
    setCalEnd(toLocalDateTimeInput(undefined, 90));
    setCalLocation('');
    setCalDescription('');
    setShowCalendarForm((v) => !v);
  };

  const openEditCalendarEventForm = (ev: CalendarEventSummary) => {
    setEditingCalendarEventId(ev.id);
    setCalSummary(ev.summary);
    setCalStart(toLocalDateTimeInput(ev.start, 60));
    setCalEnd(toLocalDateTimeInput(ev.end || ev.start, 90));
    setCalLocation(ev.location ?? '');
    setCalDescription(ev.description ?? '');
    setShowCalendarForm(true);
  };

  const handleConfirmCalendarMutation = async () => {
    if (!pendingCalendarConfirm) return;
    setIsMutatingCalendar(true);
    setWorkspaceNotice(null);
    try {
      if (pendingCalendarConfirm.action === 'create' && onCreateCalendarEvent) {
        const created = await onCreateCalendarEvent({
          summary: pendingCalendarConfirm.summary,
          start: toLocalIsoWithOffset(pendingCalendarConfirm.start!),
          end: toLocalIsoWithOffset(pendingCalendarConfirm.end!),
          location: pendingCalendarConfirm.location,
          description: pendingCalendarConfirm.description,
        });
        setWorkspaceNotice({
          tone: 'ok',
          text: `Created Google Calendar event "${created.summary}".`,
        });
        setShowCalendarForm(false);
      } else if (
        pendingCalendarConfirm.action === 'update' &&
        pendingCalendarConfirm.eventId &&
        onUpdateCalendarEvent
      ) {
        const updated = await onUpdateCalendarEvent(pendingCalendarConfirm.eventId, {
          summary: pendingCalendarConfirm.summary,
          start: pendingCalendarConfirm.start
            ? toLocalIsoWithOffset(pendingCalendarConfirm.start)
            : undefined,
          end: pendingCalendarConfirm.end
            ? toLocalIsoWithOffset(pendingCalendarConfirm.end)
            : undefined,
          location: pendingCalendarConfirm.location,
          description: pendingCalendarConfirm.description,
        });
        setWorkspaceNotice({
          tone: 'ok',
          text: `Updated Google Calendar event "${updated.summary}".`,
        });
        setShowCalendarForm(false);
        setEditingCalendarEventId(null);
      } else if (
        pendingCalendarConfirm.action === 'delete' &&
        pendingCalendarConfirm.eventId &&
        onDeleteCalendarEvent
      ) {
        await onDeleteCalendarEvent(pendingCalendarConfirm.eventId);
        setWorkspaceNotice({
          tone: 'ok',
          text: `Deleted Google Calendar event "${pendingCalendarConfirm.summary}".`,
        });
      }
      setPendingCalendarConfirm(null);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to update Google Calendar event.',
      });
      setPendingCalendarConfirm(null);
    } finally {
      setIsMutatingCalendar(false);
    }
  };

  // Google Chat reader & workbench actions
  const loadChatConversation = useCallback(
    async (
      target: string,
      opts?: {
        threadName?: string | null;
        appendOlderPageToken?: string;
        pageSize?: number;
        mergeIntoExisting?: boolean;
        searchQuery?: string;
        silent?: boolean;
      }
    ) => {
      const cleanTarget = target.trim();
      if (!cleanTarget) return;

      const isAppendingOrMerging = Boolean(opts?.appendOlderPageToken || opts?.mergeIntoExisting);
      if (isAppendingOrMerging) {
        setIsLoadingOlderChat(true);
      } else {
        setIsLoadingChatRead(true);
      }
      if (!opts?.silent) {
        setWorkspaceNotice(null);
      }

      try {
        const requestedPageSize = opts?.pageSize ?? 50;
        let data: {
          space: ChatSpaceSummary;
          messages: GoogleChatMessageSummary[];
          threads: GoogleChatThreadSummary[];
          focusedThreadName?: string;
          nextPageToken?: string;
        };

        if (onReadChatConversation) {
          data = await onReadChatConversation({
            target: cleanTarget,
            threadName: opts?.threadName ?? undefined,
            pageSize: requestedPageSize,
            pageToken: opts?.appendOlderPageToken,
            searchQuery: opts?.mergeIntoExisting ? undefined : opts?.searchQuery,
          });
        } else {
          const token = await ensureWorkspaceToken();
          if (!token) {
            throw new Error('Sign in with Google first to read Google Chat messages.');
          }
          const res = await fetch('/api/workspace/chat/read', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              target: cleanTarget,
              threadName: opts?.threadName ?? undefined,
              pageSize: requestedPageSize,
              pageToken: opts?.appendOlderPageToken,
              searchQuery: opts?.mergeIntoExisting ? undefined : opts?.searchQuery,
            }),
          });
          const json = (await res.json()) as {
            ok?: boolean;
            error?: string;
            space?: ChatSpaceSummary;
            messages?: GoogleChatMessageSummary[];
            threads?: GoogleChatThreadSummary[];
            focusedThreadName?: string;
            nextPageToken?: string;
          };
          if (!res.ok || !json.space) {
            throw new Error(json.error || 'Failed to read Google Chat conversation.');
          }
          data = {
            space: json.space,
            messages: json.messages ?? [],
            threads: json.threads ?? [],
            focusedThreadName: json.focusedThreadName,
            nextPageToken: json.nextPageToken,
          };
        }

        setActiveChatSpace(data.space);
        setSelectedSpaceName(data.space.name);
        setChatNextPageToken(data.nextPageToken ?? null);

        if (isAppendingOrMerging) {
          setLoadedMessages((prev) => {
            const byName = new Map<string, GoogleChatMessageSummary>();
            for (const m of prev) {
              byName.set(m.name, m);
            }
            for (const m of data.messages) {
              byName.set(m.name, m);
            }
            const merged = Array.from(byName.values());
            merged.sort(
              (a, b) => (Date.parse(a.createTime) || 0) - (Date.parse(b.createTime) || 0)
            );
            return merged;
          });
        } else {
          setLoadedMessages(data.messages);
          setLoadedThreads(data.threads);
          const resolvedThread =
            opts?.threadName !== undefined
              ? opts.threadName
              : (data.focusedThreadName ?? null);
          setFocusedThreadName(resolvedThread);
          setReplyThreadName(resolvedThread);
          if (resolvedThread) {
            setChatViewMode('messages');
          }
        }
      } catch (err) {
        if (!opts?.silent) {
          setWorkspaceNotice({
            tone: 'error',
            text:
              err instanceof Error
                ? err.message
                : 'Unable to read specified Google Chat space or thread.',
          });
        }
      } finally {
        setIsLoadingChatRead(false);
        setIsLoadingOlderChat(false);
      }
    },
    [onReadChatConversation]
  );

  // Auto-load the selected space's full conversation when opening the Chat tab
  useEffect(() => {
    if (
      activeTab === 'chat' &&
      isGoogleConnected &&
      workspaceBriefing.chatStatus === 'connected' &&
      !activeChatSpace &&
      !isLoadingChatRead &&
      selectedSpaceName
    ) {
      void loadChatConversation(selectedSpaceName, { silent: true });
    }
  }, [
    activeTab,
    isGoogleConnected,
    workspaceBriefing.chatStatus,
    activeChatSpace,
    isLoadingChatRead,
    selectedSpaceName,
    loadChatConversation,
  ]);

  const handleLoadAllChatSpaces = async () => {
    if (isLoadingSpacesList) return;
    setIsLoadingSpacesList(true);
    setWorkspaceNotice(null);
    try {
      if (onListChatSpaces) {
        const res = await onListChatSpaces({ filterType: 'ALL' });
        setExtraSpaces(res.spaces);
      } else {
        const token = await ensureWorkspaceToken();
        if (!token) throw new Error('Sign in with Google first.');
        const res = await fetch('/api/workspace/chat/spaces?filterType=ALL', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as {
          spaces?: ChatSpaceSummary[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || 'Failed to load spaces.');
        setExtraSpaces(json.spaces ?? []);
      }
      setWorkspaceNotice({
        tone: 'ok',
        text: 'Refreshed full Google Chat space & DM directory.',
      });
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to list Google Chat spaces.',
      });
    } finally {
      setIsLoadingSpacesList(false);
    }
  };

  const handleOpenSpecifiedChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = chatTargetInput.trim();
    if (!raw || isLoadingChatRead) return;
    await loadChatConversation(raw);
    setChatTargetInput('');
  };

  const handlePinChatSelection = async (params: {
    spaceName: string;
    spaceDisplayName: string;
    spaceType?: string;
    threadName?: string | null;
    label?: string;
    messages: GoogleChatMessageSummary[];
  }): Promise<PinnedChatContext | null> => {
    const pinKey = params.threadName || params.spaceName;
    setPinningChatKey(pinKey);
    setWorkspaceNotice(null);
    try {
      const shortThread = params.threadName
        ? params.threadName.split('/').pop()?.slice(0, 8) || 'thread'
        : '';
      const computedLabel =
        params.label ||
        (params.threadName
          ? `${params.spaceDisplayName} · Thread ${shortThread}`
          : params.spaceDisplayName);

      if (onPinChatContext) {
        const updated = await onPinChatContext({
          target: params.threadName || params.spaceName,
          spaceName: params.spaceName,
          spaceDisplayName: params.spaceDisplayName,
          spaceType: params.spaceType,
          threadName: params.threadName || undefined,
          label: computedLabel,
          messages: params.messages,
        });
        setWorkspaceNotice({
          tone: 'ok',
          text: `Pinned "${computedLabel}" (${params.messages.length} msgs) to Daniel & Village context.`,
        });
        return updated.find((p) => p.id === pinKey) ?? updated[0] ?? null;
      }

      const token = await ensureWorkspaceToken();
      const res = await fetch('/api/workspace/chat/pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          target: params.threadName || params.spaceName,
          spaceName: params.spaceName,
          spaceDisplayName: params.spaceDisplayName,
          spaceType: params.spaceType,
          threadName: params.threadName || undefined,
          label: computedLabel,
          messages: params.messages,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        pinned?: PinnedChatContext;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || 'Failed to pin chat context.');
      setWorkspaceNotice({
        tone: 'ok',
        text: `Pinned "${computedLabel}" into active Village context.`,
      });
      return json.pinned ?? null;
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to pin Google Chat conversation.',
      });
      return null;
    } finally {
      setPinningChatKey(null);
    }
  };

  const handleUnpinChatSelection = async (id: string, label: string) => {
    setWorkspaceNotice(null);
    try {
      if (onUnpinChatContext) {
        await onUnpinChatContext(id);
      } else {
        await fetch('/api/workspace/chat/unpin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
      }
      setWorkspaceNotice({
        tone: 'ok',
        text: `Removed "${label}" from pinned chat context.`,
      });
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to unpin chat context.',
      });
    }
  };

  const handleConfirmChatSend = async () => {
    if (!pendingChatConfirm) return;
    setIsSendingChat(true);
    setWorkspaceNotice(null);
    try {
      await onSendChatMessage(
        pendingChatConfirm.spaceName,
        pendingChatConfirm.text,
        pendingChatConfirm.threadName
      );
      setWorkspaceNotice({
        tone: 'ok',
        text: pendingChatConfirm.threadName
          ? `Sent reply inside thread in "${pendingChatConfirm.spaceLabel}".`
          : `Sent message to "${pendingChatConfirm.spaceLabel}" in Google Chat.`,
      });
      const sentSpace = pendingChatConfirm.spaceName;
      const sentThread = pendingChatConfirm.threadName;
      setChatMessageDraft('');
      setPendingChatConfirm(null);
      await loadChatConversation(sentSpace, {
        threadName: focusedThreadName ?? sentThread ?? null,
        silent: true,
      });
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to send Google Chat message.',
      });
    } finally {
      setIsSendingChat(false);
    }
  };

  // Google Docs actions
  const handleLinkDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docUrlInput.trim() || isImportingDoc) return;
    setIsImportingDoc(true);
    setWorkspaceNotice(null);
    try {
      await onImportGoogleDoc(docUrlInput.trim());
      setDocUrlInput('');
      setWorkspaceNotice({ tone: 'ok', text: 'Linked Google Doc into village context.' });
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to read Google Doc.',
      });
    } finally {
      setIsImportingDoc(false);
    }
  };

  const handleConfirmCreateDoc = async () => {
    if (!pendingDocConfirm) return;
    setIsCreatingDoc(true);
    setWorkspaceNotice(null);
    try {
      const created = await onCreateGoogleDoc(pendingDocConfirm.title, pendingDocConfirm.content);
      setWorkspaceNotice({ tone: 'ok', text: `Created Google Doc "${created.title}".` });
      setNewDocTitle('');
      setNewDocBody('');
      setShowNewDocForm(false);
      setPendingDocConfirm(null);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to create Google Doc.',
      });
    } finally {
      setIsCreatingDoc(false);
    }
  };

  // Working Folder Explorer actions
  const handleOpenWorkingItem = async (item: GoogleDriveFileSummary) => {
    setWorkspaceNotice(null);
    setReadOnlyExternalNotice(null);
    if (item.isFolder) {
      setBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name }]);
      setSelectedFile(null);
      return;
    }
    setIsReadingFile(true);
    try {
      const full = await onReadWorkingFolderFile(item.id);
      setSelectedFile(full);
      setEditName(full.name);
      setEditContent(full.content ?? '');
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to read file content.',
      });
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleCreateItemInWorkingFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workingFolder || !newItemName.trim() || isCreatingItem) return;
    setIsCreatingItem(true);
    setWorkspaceNotice(null);
    const isFolder = showCreateWorkingForm === 'folder';
    try {
      const created = await onCreateWorkingFolderItem({
        name: newItemName.trim(),
        content: isFolder ? undefined : newItemContent,
        isFolder,
        parentFolderId: currentExplorerFolderId ?? workingFolder.id,
      });
      setNewItemName('');
      setNewItemContent('');
      setShowCreateWorkingForm('none');
      setWorkspaceNotice({
        tone: 'ok',
        text: isFolder
          ? `Created subfolder "${created.name}".`
          : `Created "${created.name}" inside Working Folder.`,
      });
      await loadExplorerItems(currentExplorerFolderId, explorerQuery);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to create item in Working Folder.',
      });
    } finally {
      setIsCreatingItem(false);
    }
  };

  const handleSaveEditedFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || isSavingFile) return;
    setIsSavingFile(true);
    setWorkspaceNotice(null);
    setReadOnlyExternalNotice(null);
    try {
      const updated = await onUpdateWorkingFolderFile({
        fileId: selectedFile.id,
        name: editName.trim() || selectedFile.name,
        content: editContent,
      });
      setSelectedFile(updated);
      setEditName(updated.name);
      setEditContent(updated.content ?? editContent);
      setWorkspaceNotice({
        tone: 'ok',
        text: `Saved changes to "${updated.name}" in Google Drive.`,
      });
      await loadExplorerItems(currentExplorerFolderId, explorerQuery);
    } catch (err) {
      const typed = err as ReadOnlyExternalError;
      if (
        typed?.readOnlyExternal ||
        (err instanceof Error && err.message.includes('created outside the app'))
      ) {
        setReadOnlyExternalNotice(
          err instanceof Error
            ? err.message
            : 'This file was created outside this app. Save an editable copy inside your Working Folder to modify it here.'
        );
      } else {
        setWorkspaceNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Failed to save file changes.',
        });
      }
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleSaveEditableCopy = async () => {
    if (!selectedFile || !workingFolder || isCopyingEditable) return;
    setIsCopyingEditable(true);
    setWorkspaceNotice(null);
    try {
      const baseName = (editName.trim() || selectedFile.name).replace(/\.(md|txt|json)$/i, '');
      const copyName = `${baseName} (Editable).md`;
      const created = await onCreateWorkingFolderItem({
        name: copyName,
        content: editContent,
        isFolder: false,
        parentFolderId: currentExplorerFolderId ?? workingFolder.id,
      });
      setReadOnlyExternalNotice(null);
      setSelectedFile(created);
      setEditName(created.name);
      setEditContent(created.content ?? editContent);
      setWorkspaceNotice({
        tone: 'ok',
        text: `Saved editable copy "${created.name}" inside your Working Folder.`,
      });
      await loadExplorerItems(currentExplorerFolderId, explorerQuery);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to save editable copy.',
      });
    } finally {
      setIsCopyingEditable(false);
    }
  };

  const handleConfirmTrash = async () => {
    if (!pendingTrashItem || isTrashing) return;
    setIsTrashing(true);
    setWorkspaceNotice(null);
    try {
      await onTrashWorkingFolderFile(pendingTrashItem.id);
      if (selectedFile?.id === pendingTrashItem.id) {
        setSelectedFile(null);
      }
      setWorkspaceNotice({
        tone: 'ok',
        text: `Moved "${pendingTrashItem.name}" to Google Drive Trash.`,
      });
      setPendingTrashItem(null);
      await loadExplorerItems(currentExplorerFolderId, explorerQuery);
    } catch (err) {
      setPendingTrashItem(null);
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to move item to Trash.',
      });
    } finally {
      setIsTrashing(false);
    }
  };

  // Global Drive Search / Pin / Save
  const looksLikeDriveUrl = (raw: string) =>
    raw.includes('drive.google.com') ||
    raw.includes('docs.google.com/spreadsheets') ||
    raw.includes('docs.google.com/presentation') ||
    raw.includes('/folders/');

  const handleDriveSearchOrPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = driveSearchInput.trim();
    if (!trimmed) {
      setDriveSearchResults(null);
      setActiveDriveFolderId(null);
      setActiveDriveFolderName(null);
      return;
    }
    setWorkspaceNotice(null);
    if (looksLikeDriveUrl(trimmed)) {
      setPinningDriveId(trimmed);
      try {
        await onPinDriveFile(trimmed);
        setDriveSearchInput('');
        setWorkspaceNotice({ tone: 'ok', text: 'Pinned Google Drive item into village context.' });
      } catch (err) {
        setWorkspaceNotice({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Failed to read Google Drive item.',
        });
      } finally {
        setPinningDriveId(null);
      }
      return;
    }
    setIsSearchingDrive(true);
    try {
      const results = await onSearchDriveFiles(trimmed, activeDriveFolderId ?? undefined);
      setDriveSearchResults(results);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to search Google Drive.',
      });
    } finally {
      setIsSearchingDrive(false);
    }
  };

  const handleBrowseDriveFolder = async (folder: GoogleDriveFileSummary) => {
    setIsSearchingDrive(true);
    setWorkspaceNotice(null);
    try {
      const children = await onSearchDriveFiles(undefined, folder.id);
      setActiveDriveFolderId(folder.id);
      setActiveDriveFolderName(folder.name);
      setDriveSearchResults(children);
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to open Google Drive folder.',
      });
    } finally {
      setIsSearchingDrive(false);
    }
  };

  const handlePinDriveItem = async (fileId: string, name: string) => {
    setPinningDriveId(fileId);
    setWorkspaceNotice(null);
    try {
      await onPinDriveFile(fileId);
      setWorkspaceNotice({
        tone: 'ok',
        text: `Pinned "${name}" from Google Drive into village context.`,
      });
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to pin Google Drive item.',
      });
    } finally {
      setPinningDriveId(null);
    }
  };

  const handleConfirmSaveDrive = async () => {
    if (!pendingDriveConfirm) return;
    setIsSavingDrive(true);
    setWorkspaceNotice(null);
    try {
      const saved = await onSaveDriveFile({
        name: pendingDriveConfirm.name,
        content: pendingDriveConfirm.isFolder ? undefined : pendingDriveConfirm.content,
        isFolder: pendingDriveConfirm.isFolder,
        parentFolderId: pendingDriveConfirm.parentFolderId,
      });
      setWorkspaceNotice({
        tone: 'ok',
        text: pendingDriveConfirm.isFolder
          ? `Created Google Drive folder "${saved.name}".`
          : `Saved "${saved.name}" to Google Drive.`,
      });
      setNewDriveName('');
      setNewDriveContent('');
      setShowNewDriveForm(false);
      setPendingDriveConfirm(null);
      if (workingFolder) {
        void loadExplorerItems(currentExplorerFolderId, explorerQuery);
      }
    } catch (err) {
      setWorkspaceNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed to save to Google Drive.',
      });
    } finally {
      setIsSavingDrive(false);
    }
  };

  const needsGeneralConsent =
    isGoogleConnected &&
    (workspaceBriefing.chatStatus === 'needs_consent' ||
      workspaceBriefing.docsStatus === 'needs_consent' ||
      workspaceBriefing.driveStatus === 'needs_consent');

  return (
    <aside className="absolute right-3 top-3 bottom-3 z-30 w-[700px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white whitespace-nowrap">
              Daniel&apos;s Office · Workspace
            </h2>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-xs text-slate-400 truncate">
              {workspaceBriefing.email || (isGoogleConnected ? 'Synced with Inbox, Calendar & Chat' : 'Not signed in')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {danielAgent && onOpenAgentChat && (
            <button
              type="button"
              onClick={() => onOpenAgentChat(danielAgent)}
              className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              Ask Daniel
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenSettings('guardrails')}
            title="Workspace safety & permission preferences"
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings className="h-3.5 w-3.5 text-slate-400" />
            <span>Guardrails</span>
          </button>
          {isGoogleConnected && (
            <button
              type="button"
              onClick={() => void handleSyncNow()}
              disabled={isSyncing}
              title="Refresh Google Workspace now"
              aria-label="Refresh Google Workspace now"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Workspace Hub"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Unified Sub-Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-950/50 px-4 py-2 overflow-x-auto">
        {(
          [
            ['overview', 'Gmail & Overview'],
            ['calendar', `Calendar (${workspaceBriefing.upcomingEvents.length})`],
            [
              'chat',
              `Google Chat (${allKnownSpaces.length}${
                pinnedChats.length > 0 ? ` · ${pinnedChats.length} pinned` : ''
              })`,
            ],
            ['docs', `Docs (${linkedDocs.length})`],
            ['drive', 'Drive'],
          ] as Array<[WorkspaceTab, string]>
        ).map(([tabId, label]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              activeTab === tabId
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Connection / Consent / Feedback Banner */}
      {(!isGoogleConnected || needsGeneralConsent || workspaceNotice) && (
        <div className="border-b border-slate-800 px-4 py-2.5 space-y-2 bg-slate-950/60">
          {!isGoogleConnected && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-300">
                Sign in with Google to view Gmail, edit Calendar, open Chat spaces, link Docs, and browse Drive.
              </p>
              <button type="button" onClick={onGoogleSignIn} className="gsi-material-button">
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">Sign in with Google</span>
                </div>
              </button>
            </div>
          )}

          {needsGeneralConsent && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2">
              <span className="text-xs text-amber-200">
                Additional Google Workspace permission is needed for Chat, Docs, or Drive tools.
              </span>
              <button
                type="button"
                onClick={() => void onGrantWorkspaceConsent()}
                className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                Grant Workspace Access
              </button>
            </div>
          )}

          {workspaceNotice && (
            <div
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                workspaceNotice.tone === 'error'
                  ? 'border-rose-500/40 bg-rose-950/50 text-rose-200'
                  : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
              }`}
            >
              <span>{workspaceNotice.text}</span>
              <button
                type="button"
                onClick={() => setWorkspaceNotice(null)}
                aria-label="Dismiss notice"
                className="text-slate-400 hover:text-white cursor-pointer shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            {onOpenMorningBriefing && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">
                    Executive Morning Briefing (Written + Voice)
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Matt &amp; Daniel synthesize unread Gmail, today&apos;s schedule, and pending sign-offs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenMorningBriefing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sun className="h-3.5 w-3.5" />
                  <span>Open Briefing</span>
                </button>
              </div>
            )}

            {/* Quick Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => setActiveTab('calendar')}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-sky-500/50 transition-colors cursor-pointer"
              >
                <p className="text-[11px] text-slate-400">Calendar</p>
                <p className="mt-1 text-sm font-bold text-white tabular-nums">
                  {workspaceBriefing.upcomingEvents.length} events
                </p>
                <p className="mt-0.5 text-[11px] text-sky-300">
                  {calendarWriteAccess && workspaceBriefing.calendarStatus === 'connected_write'
                    ? 'Write enabled'
                    : 'Read-only'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-violet-500/50 transition-colors cursor-pointer"
              >
                <p className="text-[11px] text-slate-400">Google Chat</p>
                <p className="mt-1 text-sm font-bold text-white tabular-nums">
                  {allKnownSpaces.length} spaces
                </p>
                <p className="mt-0.5 text-[11px] text-violet-300">
                  {pinnedChats.length > 0
                    ? `${pinnedChats.length} pinned to context`
                    : 'Read spaces & threads'}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('docs')}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-blue-500/50 transition-colors cursor-pointer"
              >
                <p className="text-[11px] text-slate-400">Linked Docs</p>
                <p className="mt-1 text-sm font-bold text-white tabular-nums">
                  {linkedDocs.length} docs
                </p>
                <p className="mt-0.5 text-[11px] text-blue-300">Link or create</p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('drive')}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-left hover:border-orange-500/50 transition-colors cursor-pointer"
              >
                <p className="text-[11px] text-slate-400">Drive Folder</p>
                <p className="mt-1 text-sm font-bold text-white truncate">
                  {workingFolder ? workingFolder.name : 'Not linked'}
                </p>
                <p className="mt-0.5 text-[11px] text-orange-300">
                  {workingFolder ? 'Browse & edit' : 'Setup in Guardrails'}
                </p>
              </button>
            </div>

            {/* Gmail Inbox & Configured Labels */}
            {(() => {
              const activeSourcesCount =
                (gmailIncludeInbox ? 1 : 0) + gmailSelectedLabels.length;
              const inboxSummary = mergedGmailLabels.find((l) => l.id === 'INBOX');
              const selectableNonInbox = mergedGmailLabels.filter((l) => l.id !== 'INBOX');
              const labelQueryLower = gmailLabelFilterInput.trim().toLowerCase();
              const filteredPickerLabels = labelQueryLower
                ? selectableNonInbox.filter((l) => l.name.toLowerCase().includes(labelQueryLower))
                : selectableNonInbox;
              const userCustomLabels = filteredPickerLabels.filter((l) => l.type === 'user');
              const systemPickerLabels = filteredPickerLabels.filter((l) => l.type === 'system');

              const sourceHeaderLabel =
                gmailIncludeInbox && gmailSelectedLabels.length === 0
                  ? 'Gmail · Inbox'
                  : gmailIncludeInbox && gmailSelectedLabels.length > 0
                    ? `Gmail · Inbox + ${gmailSelectedLabels.length} ${
                        gmailSelectedLabels.length === 1 ? 'label' : 'labels'
                      }`
                    : !gmailIncludeInbox && gmailSelectedLabels.length > 0
                      ? `Gmail · ${gmailSelectedLabels.map((l) => l.name).slice(0, 2).join(', ')}${
                          gmailSelectedLabels.length > 2
                            ? ` +${gmailSelectedLabels.length - 2}`
                            : ''
                        }`
                      : 'Gmail · No sources selected';

              const summarizeSourcesPrompt = (() => {
                const parts: string[] = [];
                if (gmailIncludeInbox) parts.push('Inbox');
                for (const l of gmailSelectedLabels) parts.push(`label "${l.name}"`);
                const scopeDesc = parts.length > 0 ? parts.join(' and ') : 'Gmail';
                return `Review my unread Gmail messages across ${scopeDesc} and my Calendar schedule, then stage follow-up drafts in Approvals`;
              })();

              const baseEmails = customFetchedEmails ?? workspaceBriefing.recentEmails;
              const searchKeywords = parseSearchKeywords(gmailSearchInput);
              const displayedEmails = baseEmails.filter((m) => {
                if (gmailUnreadOnly && m.isUnread === false) return false;
                if (customFetchedEmails === null && activeGmailFilterId !== 'ALL_MONITORED') {
                  if (!(m.labelIds ?? []).includes(activeGmailFilterId)) return false;
                }
                if (searchKeywords.length > 0 && customFetchedEmails === null) {
                  const hay = `${m.subject} ${m.from} ${m.snippet} ${(m.labelNames ?? []).join(' ')}`.toLowerCase();
                  if (!searchKeywords.every((kw) => hay.includes(kw))) return false;
                }
                return true;
              });

              return (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="h-4 w-4 text-emerald-400 shrink-0" />
                      <h3 className="text-xs font-semibold text-white tabular-nums truncate">
                        {sourceHeaderLabel}
                        {activeSourcesCount > 0 ? ` · ${workspaceBriefing.unreadCount} unread` : ''}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {onUpdateGmailSources && (
                        <button
                          type="button"
                          onClick={() => setShowGmailLabelConfig((v) => !v)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                            showGmailLabelConfig
                              ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                              : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 hover:text-white'
                          }`}
                        >
                          <Tag className="h-3 w-3 text-emerald-400" />
                          <span>Labels &amp; Inbox ({activeSourcesCount})</span>
                        </button>
                      )}
                      {onPrefillTask && activeSourcesCount > 0 && (
                        <button
                          type="button"
                          onClick={() => onPrefillTask(summarizeSourcesPrompt)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>Summarize as Task</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Active Source Summary Line */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span>Monitored:</span>
                      <span className="text-slate-200">
                        {activeSourcesCount === 0
                          ? 'None'
                          : [
                              ...(gmailIncludeInbox ? ['Primary Inbox'] : []),
                              ...gmailSelectedLabels.map((l) => l.name),
                            ].join(' · ')}
                      </span>
                    </div>
                    {(!gmailIncludeInbox || gmailSelectedLabels.length > 0) &&
                      onUpdateGmailSources && (
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateGmailSources({ includeInbox: true, selectedLabels: [] });
                            setActiveGmailFilterId('ALL_MONITORED');
                            setCustomFetchedEmails(null);
                          }}
                          className="text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Reset to Inbox only
                        </button>
                      )}
                  </div>

                  {/* Expandable Labels & Inbox Configurator */}
                  {showGmailLabelConfig && onUpdateGmailSources && (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-white">
                            Choose Gmail Sources (Inbox &amp; Labels)
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Toggle Primary Inbox and check any Gmail labels to sync into Guildhaven and Daniel&apos;s context.
                          </p>
                        </div>
                        {isGoogleConnected && onListGmailLabels && (
                          <button
                            type="button"
                            onClick={() => void refreshGmailLabelsCatalog()}
                            disabled={isLoadingGmailLabels}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isLoadingGmailLabels ? 'animate-spin' : ''}`}
                            />
                            <span>Refresh Labels</span>
                          </button>
                        )}
                      </div>

                      {/* Primary Inbox Toggle */}
                      <button
                        type="button"
                        onClick={handleToggleIncludeInbox}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                          gmailIncludeInbox
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-white'
                            : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                              gmailIncludeInbox
                                ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                : 'border-slate-600 bg-slate-900'
                            }`}
                          >
                            {gmailIncludeInbox && <Check className="h-3 w-3 stroke-[3]" />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">Primary Inbox (INBOX)</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              Include standard incoming emails in your Inbox
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-300 shrink-0">
                          {typeof inboxSummary?.messagesUnread === 'number'
                            ? `${inboxSummary.messagesUnread} unread · `
                            : ''}
                          {gmailIncludeInbox ? 'Included' : 'Excluded'}
                        </span>
                      </button>

                      {/* Label Search & Checklist */}
                      {!isGoogleConnected ? (
                        <p className="text-xs text-slate-400">
                          Sign in with Google above to load your custom and system Gmail labels.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                            <input
                              type="text"
                              value={gmailLabelFilterInput}
                              onChange={(e) => setGmailLabelFilterInput(e.target.value)}
                              placeholder="Filter Gmail labels by name..."
                              className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                            />
                            {gmailLabelFilterInput && (
                              <button
                                type="button"
                                onClick={() => setGmailLabelFilterInput('')}
                                aria-label="Clear label filter"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          {isLoadingGmailLabels && selectableNonInbox.length === 0 ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                              <span>Loading labels from Gmail...</span>
                            </div>
                          ) : filteredPickerLabels.length === 0 ? (
                            <p className="text-[11px] text-slate-500 py-1">
                              {selectableNonInbox.length === 0
                                ? 'No additional Gmail labels found on this account yet.'
                                : 'No Gmail labels match that filter.'}
                            </p>
                          ) : (
                            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/75 divide-y divide-slate-800/70">
                              {userCustomLabels.length > 0 && (
                                <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-slate-950">
                                  Custom Labels ({userCustomLabels.length})
                                </div>
                              )}
                              {userCustomLabels.map((lbl) => {
                                const checked = gmailSelectedLabels.some((s) => s.id === lbl.id);
                                return (
                                  <button
                                    key={lbl.id}
                                    type="button"
                                    onClick={() => handleToggleGmailLabel(lbl)}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-900/90 transition-colors cursor-pointer"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <span
                                        className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                                          checked
                                            ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                            : 'border-slate-600 bg-slate-900'
                                        }`}
                                      >
                                        {checked && <Check className="h-3 w-3 stroke-[3]" />}
                                      </span>
                                      <span className="text-xs font-medium text-slate-100 truncate">
                                        {lbl.name}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                                      {typeof lbl.messagesUnread === 'number'
                                        ? `${lbl.messagesUnread} unread`
                                        : checked
                                          ? 'Selected'
                                          : ''}
                                    </span>
                                  </button>
                                );
                              })}

                              {systemPickerLabels.length > 0 && (
                                <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-slate-950">
                                  Gmail System Views ({systemPickerLabels.length})
                                </div>
                              )}
                              {systemPickerLabels.map((lbl) => {
                                const checked = gmailSelectedLabels.some((s) => s.id === lbl.id);
                                return (
                                  <button
                                    key={lbl.id}
                                    type="button"
                                    onClick={() => handleToggleGmailLabel(lbl)}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-900/90 transition-colors cursor-pointer"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <span
                                        className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                                          checked
                                            ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                            : 'border-slate-600 bg-slate-900'
                                        }`}
                                      >
                                        {checked && <Check className="h-3 w-3 stroke-[3]" />}
                                      </span>
                                      <span className="text-xs font-medium text-slate-200 truncate">
                                        {lbl.name}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                                      {typeof lbl.messagesUnread === 'number'
                                        ? `${lbl.messagesUnread} unread`
                                        : checked
                                          ? 'Selected'
                                          : ''}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Source Filter Bar + Search when connected */}
                  {workspaceBriefing.connected && activeSourcesCount > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-0.5">
                        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 overflow-x-auto">
                          {activeSourcesCount > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveGmailFilterId('ALL_MONITORED');
                                void loadFilteredGmailMessages({
                                  filterId: 'ALL_MONITORED',
                                  unreadOnly: gmailUnreadOnly,
                                  query: gmailSearchInput,
                                });
                              }}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                activeGmailFilterId === 'ALL_MONITORED'
                                  ? 'bg-slate-700 text-white font-semibold'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              All ({workspaceBriefing.unreadCount} unread)
                            </button>
                          )}
                          {gmailIncludeInbox && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextId =
                                  activeSourcesCount > 1 && activeGmailFilterId !== 'INBOX'
                                    ? 'INBOX'
                                    : activeSourcesCount > 1
                                      ? 'ALL_MONITORED'
                                      : 'INBOX';
                                setActiveGmailFilterId(nextId);
                                void loadFilteredGmailMessages({
                                  filterId: nextId,
                                  unreadOnly: gmailUnreadOnly,
                                  query: gmailSearchInput,
                                });
                              }}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                activeGmailFilterId === 'INBOX' || activeSourcesCount === 1
                                  ? 'bg-slate-700 text-white font-semibold'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              Inbox
                              {typeof inboxSummary?.messagesUnread === 'number'
                                ? ` (${inboxSummary.messagesUnread})`
                                : ''}
                            </button>
                          )}
                          {gmailSelectedLabels.map((lbl) => {
                            const detail = mergedGmailLabels.find((m) => m.id === lbl.id);
                            const isSelectedTab =
                              activeGmailFilterId === lbl.id ||
                              (!gmailIncludeInbox && gmailSelectedLabels.length === 1);
                            return (
                              <button
                                key={lbl.id}
                                type="button"
                                onClick={() => {
                                  const nextId =
                                    activeSourcesCount > 1 && activeGmailFilterId === lbl.id
                                      ? 'ALL_MONITORED'
                                      : lbl.id;
                                  setActiveGmailFilterId(nextId);
                                  void loadFilteredGmailMessages({
                                    filterId: nextId,
                                    unreadOnly: gmailUnreadOnly,
                                    query: gmailSearchInput,
                                  });
                                }}
                                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                  isSelectedTab
                                    ? 'bg-emerald-500 text-slate-950 font-semibold'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                {lbl.name}
                                {typeof detail?.messagesUnread === 'number'
                                  ? ` (${detail.messagesUnread})`
                                  : ''}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const nextUnread = !gmailUnreadOnly;
                            setGmailUnreadOnly(nextUnread);
                            void loadFilteredGmailMessages({
                              filterId: activeGmailFilterId,
                              unreadOnly: nextUnread,
                              query: gmailSearchInput,
                            });
                          }}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            gmailUnreadOnly
                              ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200'
                              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                          }`}
                        >
                          Unread only
                        </button>
                      </div>

                      {/* Search Messages Across Selected Sources */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void loadFilteredGmailMessages({
                            filterId: activeGmailFilterId,
                            unreadOnly: gmailUnreadOnly,
                            query: gmailSearchInput,
                          });
                        }}
                        className="flex items-center gap-2"
                      >
                        <div className="relative flex-1 min-w-0">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                          <input
                            type="text"
                            value={gmailSearchInput}
                            onChange={(e) => {
                              setGmailSearchInput(e.target.value);
                              if (!e.target.value.trim() && activeGmailFilterId === 'ALL_MONITORED' && !gmailUnreadOnly) {
                                setCustomFetchedEmails(null);
                              }
                            }}
                            placeholder="Filter or search messages in monitored sources..."
                            className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                          />
                          {gmailSearchInput && (
                            <button
                              type="button"
                              onClick={() => {
                                setGmailSearchInput('');
                                void loadFilteredGmailMessages({
                                  filterId: activeGmailFilterId,
                                  unreadOnly: gmailUnreadOnly,
                                  query: '',
                                });
                              }}
                              aria-label="Clear email search"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {onReadGmailMessages && (
                          <button
                            type="submit"
                            disabled={isLoadingCustomEmails}
                            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {isLoadingCustomEmails ? 'Searching...' : 'Search Gmail'}
                          </button>
                        )}
                      </form>
                    </div>
                  )}

                  {!workspaceBriefing.connected ? (
                    <p className="text-xs text-slate-400">
                      {isGoogleConnected
                        ? 'Syncing Gmail messages...'
                        : 'Sign in with Google above to view your Inbox and Gmail labels.'}
                    </p>
                  ) : activeSourcesCount === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <p className="text-xs text-slate-300">
                        Neither Primary Inbox nor any Gmail label is currently selected.
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        {onUpdateGmailSources && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateGmailSources({
                                includeInbox: true,
                                selectedLabels: gmailSelectedLabels,
                              })
                            }
                            className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Enable Inbox
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowGmailLabelConfig(true)}
                          className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Choose Labels
                        </button>
                      </div>
                    </div>
                  ) : isLoadingCustomEmails ? (
                    <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                      <span>Loading Gmail messages...</span>
                    </div>
                  ) : displayedEmails.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      {gmailUnreadOnly
                        ? 'No unread messages in the selected Gmail sources.'
                        : gmailSearchInput.trim()
                          ? 'No messages matched your filter. Click "Search Gmail" to query older threads.'
                          : 'No messages returned in the selected Gmail sources.'}
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-slate-900/60">
                      {displayedEmails.slice(0, 14).map((m) => {
                        const isExpanded = expandedEmailId === m.id;
                        const labelText =
                          m.labelNames && m.labelNames.length > 0
                            ? m.labelNames.join(', ')
                            : '';
                        return (
                          <div key={m.id} className="p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (isExpanded) {
                                    setExpandedEmailId(null);
                                    return;
                                  }
                                  setExpandedEmailId(m.id);
                                  if (!m.bodyExcerpt && onReadGmailMessages) {
                                    try {
                                      const detailRes = await onReadGmailMessages({
                                        query: `rfc822msgid:${m.id}`,
                                        maxResults: 1,
                                        includeBody: true,
                                      });
                                      if (detailRes.messages.length === 0) {
                                        // Fallback fetch by subject/from if rfc822msgid differs from Gmail message ID
                                        const byIdRes = await onReadGmailMessages({
                                          labelIds: m.labelIds?.slice(0, 2),
                                          query: m.subject ? `"${m.subject.slice(0, 40)}"` : undefined,
                                          maxResults: 5,
                                          includeBody: true,
                                        });
                                        const found = byIdRes.messages.find((x) => x.id === m.id);
                                        if (found?.bodyExcerpt) {
                                          setCustomFetchedEmails((prev) =>
                                            (prev ?? workspaceBriefing.recentEmails).map((item) =>
                                              item.id === m.id
                                                ? { ...item, bodyExcerpt: found.bodyExcerpt }
                                                : item
                                            )
                                          );
                                        }
                                      }
                                    } catch {
                                      // Keep snippet fallback cleanly
                                    }
                                  }
                                }}
                                className={`text-left text-xs truncate cursor-pointer hover:text-amber-200 ${
                                  m.isUnread
                                    ? 'font-semibold text-white'
                                    : 'font-medium text-slate-200'
                                }`}
                              >
                                {renderHighlightedText(m.subject, gmailSearchInput)}
                              </button>
                              <div className="flex items-center gap-2.5 shrink-0">
                                {onAskDanielWithPrompt && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onAskDanielWithPrompt(
                                        `Read my Gmail thread "${m.subject}" from ${m.from}${
                                          labelText ? ` (labels: ${labelText})` : ''
                                        } and summarize key action items.`
                                      )
                                    }
                                    className="text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Ask Daniel
                                  </button>
                                )}
                                {onPrefillTask && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onPrefillTask(
                                        `Draft a thoughtful Gmail reply to "${m.subject}" from ${m.from} (stays a draft for my approval)`
                                      )
                                    }
                                    className="text-[11px] text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Draft Reply
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Clean unboxed inline metadata with dot separators */}
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                              <span className="truncate max-w-[260px]">
                                From: {renderHighlightedText(m.from, gmailSearchInput)}
                              </span>
                              {labelText && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-emerald-300/90 truncate max-w-[200px]">
                                    {labelText}
                                  </span>
                                </>
                              )}
                              {m.isUnread && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-medium text-amber-300">Unread</span>
                                </>
                              )}
                            </div>

                            {(m.bodyExcerpt || m.snippet) && (
                              <p
                                className={`text-[11px] text-slate-300 ${
                                  isExpanded ? 'whitespace-pre-wrap pt-1' : 'line-clamp-2'
                                }`}
                              >
                                {renderHighlightedText(
                                  isExpanded ? m.bodyExcerpt || m.snippet : m.snippet,
                                  gmailSearchInput
                                )}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500">
                    Safety rule: Villagers can never send emails automatically — replies are always staged as Gmail Drafts in Approvals.
                  </p>
                </div>
              );
            })()}
          </>
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-4">
            {/* Permission & Mode Status */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-white">
                  Primary Calendar ·{' '}
                  <span
                    className={
                      calendarWriteAccess && workspaceBriefing.calendarStatus === 'connected_write'
                        ? 'text-emerald-300'
                        : 'text-amber-300'
                    }
                  >
                    {!calendarWriteAccess
                      ? 'Read-Only Mode'
                      : workspaceBriefing.calendarStatus === 'connected_write'
                        ? 'Write Access Authorized'
                        : 'Google Permission Needed'}
                  </span>
                </p>
                <p className="text-[11px] text-slate-400">
                  {calendarWriteAccess
                    ? 'Every event creation, edit, or deletion asks for confirmation first.'
                    : 'Enable Write Access in Guardrails to schedule or edit events directly.'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!calendarWriteAccess ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (onEnableCalendarWriteAccess) {
                        onEnableCalendarWriteAccess();
                      } else {
                        onOpenSettings('guardrails');
                      }
                    }}
                    className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Enable Write Access
                  </button>
                ) : isGoogleConnected &&
                  workspaceBriefing.calendarStatus !== 'connected_write' ? (
                  <button
                    type="button"
                    disabled={isGrantingCalendar}
                    onClick={async () => {
                      setIsGrantingCalendar(true);
                      try {
                        await onGrantCalendarWriteConsent();
                        setWorkspaceNotice({
                          tone: 'ok',
                          text: 'Google Calendar write permission granted.',
                        });
                      } catch (err) {
                        setWorkspaceNotice({
                          tone: 'error',
                          text:
                            err instanceof Error
                              ? err.message
                              : 'Unable to authorize Calendar write access.',
                        });
                      } finally {
                        setIsGrantingCalendar(false);
                      }
                    }}
                    className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isGrantingCalendar ? 'Authorizing...' : 'Grant Calendar Write'}
                  </button>
                ) : (
                  onCreateCalendarEvent && (
                    <button
                      type="button"
                      onClick={openNewCalendarEventForm}
                      className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      <span>
                        {showCalendarForm && !editingCalendarEventId ? 'Close Form' : 'New Event'}
                      </span>
                    </button>
                  )
                )}
              </div>
            </div>

            {calendarWriteAccess && showCalendarForm && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!calSummary.trim() || !calStart || !calEnd) return;
                  setPendingCalendarConfirm({
                    action: editingCalendarEventId ? 'update' : 'create',
                    eventId: editingCalendarEventId ?? undefined,
                    summary: calSummary.trim(),
                    start: calStart,
                    end: calEnd,
                    location: calLocation.trim() || undefined,
                    description: calDescription.trim() || undefined,
                  });
                }}
                className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">
                    {editingCalendarEventId ? 'Edit Calendar Event' : 'New Calendar Event'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCalendarForm(false);
                      setEditingCalendarEventId(null);
                    }}
                    aria-label="Cancel event form"
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={calSummary}
                  onChange={(e) => setCalSummary(e.target.value)}
                  placeholder="Event title (e.g. Weekly Operations Sync)"
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="space-y-1 text-[11px] text-slate-400">
                    <span>Start</span>
                    <input
                      type="datetime-local"
                      required
                      value={calStart}
                      onChange={(e) => setCalStart(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-slate-400">
                    <span>End</span>
                    <input
                      type="datetime-local"
                      required
                      value={calEnd}
                      onChange={(e) => setCalEnd(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={calLocation}
                  onChange={(e) => setCalLocation(e.target.value)}
                  placeholder="Location or video link (optional)"
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <textarea
                  rows={2}
                  value={calDescription}
                  onChange={(e) => setCalDescription(e.target.value)}
                  placeholder="Notes / agenda (optional)..."
                  className="w-full rounded-md border border-slate-700 bg-slate-900 p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="submit"
                    disabled={!calSummary.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    <span>{editingCalendarEventId ? 'Review Changes' : 'Review & Schedule'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* Upcoming Events List */}
            {workspaceBriefing.upcomingEvents.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
                No upcoming events scheduled on your primary calendar.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/60">
                {workspaceBriefing.upcomingEvents.map((ev) => (
                  <div key={ev.id} className="flex items-start justify-between gap-3 p-3.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        <span className="text-xs font-semibold text-white truncate">
                          {ev.summary}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 tabular-nums">
                        {formatCalendarTimestamp(ev.start)}
                        {ev.end ? ` – ${formatCalendarTimestamp(ev.end)}` : ''}
                      </p>
                      {ev.location && (
                        <p className="text-[11px] text-slate-400 truncate">
                          Location: {ev.location}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {ev.htmlLink && (
                        <a
                          href={ev.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${ev.summary} in Google Calendar`}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {calendarWriteAccess && onUpdateCalendarEvent && (
                        <button
                          type="button"
                          onClick={() => openEditCalendarEventForm(ev)}
                          title="Edit event"
                          aria-label={`Edit ${ev.summary}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-sky-300 cursor-pointer"
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {calendarWriteAccess && onDeleteCalendarEvent && (
                        <button
                          type="button"
                          onClick={() =>
                            setPendingCalendarConfirm({
                              action: 'delete',
                              eventId: ev.id,
                              summary: ev.summary,
                              start: ev.start,
                              end: ev.end,
                            })
                          }
                          title="Delete event"
                          aria-label={`Delete ${ev.summary}`}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && (() => {
          const rawOrigin =
            typeof window !== 'undefined' ? window.location.origin : '';
          const isPreviewSandbox =
            !rawOrigin ||
            rawOrigin.startsWith('https://ais-dev-') ||
            rawOrigin.startsWith('https://ais-pre-') ||
            rawOrigin.includes('localhost');
          const instantPublicAvatarUrl =
            'https://developers.google.com/static/workspace/chat/images/quickstart-app-avatar.png';
          const chatAvatarUrl =
            publishedChatAvatarUrl ||
            (!isPreviewSandbox
              ? `${rawOrigin}/guildhaven-chat-avatar.jpg`
              : instantPublicAvatarUrl);
          const chatAppDescription =
            'Guildhaven executive workspace assistant for reading Google Chat spaces & threads and staging human-approved replies.';

          const handlePublishCustomAvatarToDrive = async () => {
            if (isPublishingAvatar) return;
            setIsPublishingAvatar(true);
            setWorkspaceNotice(null);
            try {
              const token = await ensureWorkspaceToken();
              if (!token) {
                throw new Error('Sign in with Google first to host the custom avatar on Drive.');
              }
              const res = await fetch('/api/workspace/chat/publish-avatar', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = (await res.json()) as {
                ok?: boolean;
                avatarUrl?: string;
                error?: string;
              };
              if (!res.ok || !data.avatarUrl) {
                throw new Error(data.error || 'Could not publish custom avatar to Google Drive.');
              }
              setPublishedChatAvatarUrl(data.avatarUrl);
              void navigator.clipboard?.writeText(data.avatarUrl);
              setWorkspaceNotice({
                tone: 'ok',
                text: 'Hosted custom Guildhaven avatar on Google Drive and copied its public HTTPS URL!',
              });
            } catch (err) {
              setWorkspaceNotice({
                tone: 'error',
                text:
                  err instanceof Error
                    ? err.message
                    : 'Unable to publish custom avatar to Google Drive.',
              });
            } finally {
              setIsPublishingAvatar(false);
            }
          };

          const pinnedIds = new Set(pinnedChats.map((p) => p.id));
          const spaceQueryNeedle = spaceSearchQuery.trim().toLowerCase();
          const filteredSpaces = allKnownSpaces.filter((sp) => {
            const spType = (sp.spaceType || 'SPACE').toUpperCase();
            if (spaceFilterMode === 'spaces' && spType !== 'SPACE') return false;
            if (
              spaceFilterMode === 'dms' &&
              spType !== 'DIRECT_MESSAGE' &&
              spType !== 'GROUP_CHAT'
            ) {
              return false;
            }
            if (
              spaceFilterMode === 'pinned' &&
              !pinnedChats.some((p) => p.spaceName === sp.name)
            ) {
              return false;
            }
            if (!spaceQueryNeedle) return true;
            return (
              sp.displayName.toLowerCase().includes(spaceQueryNeedle) ||
              sp.name.toLowerCase().includes(spaceQueryNeedle)
            );
          });

          const currentSpace =
            activeChatSpace ||
            allKnownSpaces.find((s) => s.name === selectedSpaceName) ||
            allKnownSpaces[0] ||
            (pinnedChats[0]
              ? {
                  name: pinnedChats[0].spaceName,
                  displayName: pinnedChats[0].spaceDisplayName,
                  spaceType: pinnedChats[0].spaceType,
                  recentMessages: pinnedChats[0].messages.slice(-5).reverse(),
                }
              : null);

          // Hydrate base messages from live-loaded history, falling back to pinned/recent cache so search works immediately
          const fallbackPinned = currentSpace
            ? pinnedChats.find(
                (p) =>
                  (focusedThreadName && p.threadName === focusedThreadName) ||
                  (!focusedThreadName && p.spaceName === currentSpace.name && !p.threadName) ||
                  p.spaceName === currentSpace.name
              )
            : undefined;

          const baseMessages: GoogleChatMessageSummary[] =
            loadedMessages.length > 0
              ? loadedMessages
              : fallbackPinned && fallbackPinned.messages.length > 0
                ? [...fallbackPinned.messages].sort(
                    (a, b) => (Date.parse(a.createTime) || 0) - (Date.parse(b.createTime) || 0)
                  )
                : currentSpace
                  ? [...currentSpace.recentMessages].sort(
                      (a, b) => (Date.parse(a.createTime) || 0) - (Date.parse(b.createTime) || 0)
                    )
                  : [];

          // Locally filter & group messages so keyword filtering and thread drill-down are instant
          const searchKeywords = parseSearchKeywords(chatMessageFilter);
          const hasActiveKeywordSearch = searchKeywords.length > 0;
          const threadFilteredMessages = focusedThreadName
            ? baseMessages.filter((m) => (m.threadName || m.name) === focusedThreadName)
            : baseMessages;

          const visibleMessages = hasActiveKeywordSearch
            ? threadFilteredMessages.filter((m) => matchesChatKeyword(m, searchKeywords))
            : threadFilteredMessages;

          // Build reply counts per thread across baseMessages
          const replyCountByThread = new Map<string, number>();
          for (const m of baseMessages) {
            const tk = m.threadName || m.name;
            replyCountByThread.set(tk, (replyCountByThread.get(tk) ?? 0) + 1);
          }

          const computedThreads: GoogleChatThreadSummary[] = (() => {
            if (loadedThreads.length > 0 && !hasActiveKeywordSearch && loadedMessages.length <= 50) {
              return loadedThreads;
            }
            const sourceList = hasActiveKeywordSearch ? visibleMessages : baseMessages;
            const map = new Map<string, GoogleChatMessageSummary[]>();
            for (const m of sourceList) {
              const tk = m.threadName || m.name;
              const arr = map.get(tk);
              if (arr) arr.push(m);
              else map.set(tk, [m]);
            }
            const out: GoogleChatThreadSummary[] = [];
            for (const [tk, list] of map.entries()) {
              const root = list[0];
              const last = list[list.length - 1];
              const parts = Array.from(new Set(list.map((x) => x.senderName)));
              out.push({
                threadName: tk,
                spaceName: currentSpace?.name ?? '',
                rootSenderName: root.senderName,
                rootText: root.text,
                replyCount: Math.max(0, list.length - 1),
                messageCount: list.length,
                participants: parts,
                firstMessageTime: root.createTime,
                lastUpdateTime: last.createTime || root.createTime,
                messages: list,
              });
            }
            return out.sort(
              (a, b) => (Date.parse(b.lastUpdateTime) || 0) - (Date.parse(a.lastUpdateTime) || 0)
            );
          })();

          const handleScanOlderHistory = () => {
            if (!currentSpace || workspaceBriefing.chatStatus !== 'connected') return;
            void loadChatConversation(currentSpace.name, {
              threadName: focusedThreadName,
              pageSize: 100,
              appendOlderPageToken: chatNextPageToken ?? undefined,
              mergeIntoExisting: true,
            });
          };

          const activePinKey = currentSpace
            ? focusedThreadName || currentSpace.name
            : '';
          const isCurrentSelectionPinned = Boolean(activePinKey && pinnedIds.has(activePinKey));
          const shortFocusedThread = focusedThreadName
            ? focusedThreadName.split('/').pop()?.slice(0, 10) || focusedThreadName
            : null;
          const activeContextLabel = currentSpace
            ? focusedThreadName
              ? `${currentSpace.displayName} · Thread ${shortFocusedThread}`
              : currentSpace.displayName
            : 'Google Chat';

          const formatChatMsgTime = (iso?: string) => {
            if (!iso) return '';
            const ts = Date.parse(iso);
            if (!Number.isFinite(ts)) return '';
            return new Date(ts).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
          };

          const formatSpaceTypeLabel = (raw?: string) => {
            if (raw === 'DIRECT_MESSAGE') return 'DM';
            if (raw === 'GROUP_CHAT') return 'Group';
            return 'Space';
          };

          const triggerWorkWithDaniel = async (
            mode: 'summarize' | 'actions' | 'ask' | 'task' | 'doc'
          ) => {
            if (!currentSpace) return;
            const contextMsgs = visibleMessages.length > 0 ? visibleMessages : currentSpace.recentMessages;

            if (mode === 'doc') {
              const transcriptBody = [
                `Google Chat Transcript — ${activeContextLabel}`,
                `Space Resource: ${currentSpace.name}`,
                focusedThreadName ? `Thread Resource: ${focusedThreadName}` : '',
                `Exported: ${new Date().toLocaleString()}`,
                '',
                ...contextMsgs.map(
                  (m) =>
                    `[${formatChatMsgTime(m.createTime) || m.createTime}] ${m.senderName}: ${m.text}`
                ),
              ]
                .filter(Boolean)
                .join('\n');
              setPendingDocConfirm({
                title: `Chat Notes — ${activeContextLabel}`,
                content: transcriptBody,
              });
              return;
            }

            // Ensure the active space/thread is pinned so Daniel & collaborating Houses have the full transcript
            if (!isCurrentSelectionPinned && contextMsgs.length > 0) {
              await handlePinChatSelection({
                spaceName: currentSpace.name,
                spaceDisplayName: currentSpace.displayName,
                spaceType: currentSpace.spaceType,
                threadName: focusedThreadName,
                label: activeContextLabel,
                messages: contextMsgs,
              });
            }

            const refTarget = focusedThreadName
              ? `thread "${focusedThreadName}" in Google Chat space "${currentSpace.displayName}" (${currentSpace.name})`
              : `Google Chat space "${currentSpace.displayName}" (${currentSpace.name})`;

            if (mode === 'task' && onPrefillTask) {
              onPrefillTask(
                `@Daniel Using the pinned messages from ${refTarget}, summarize key decisions, coordinate any cross-House follow-ups, and stage any needed reply for my approval`
              );
              return;
            }

            const prompt =
              mode === 'summarize'
                ? `Summarize the conversation in ${refTarget}. Highlight key decisions, blockers, and open questions.`
                : mode === 'actions'
                  ? `Extract every concrete action item, owner, and follow-up from ${refTarget}, and tell me if we should hand off any items to Kieran, Eli, Aria, or Marcus.`
                  : `Working with ${refTarget}: `;

            if (onAskDanielWithPrompt) {
              onAskDanielWithPrompt(prompt);
            } else if (danielAgent && onOpenAgentChat) {
              onOpenAgentChat(danielAgent);
            }
          };

          return (
            <div className="space-y-3">
              {/* Top Section: Header + Open Specified Space/Thread by URL or ID */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-violet-300 shrink-0" />
                    <span className="text-xs font-semibold text-white">
                      Daniel&apos;s Google Chat Reader &amp; Thread Workbench
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {isGoogleConnected && workspaceBriefing.chatStatus === 'connected' && (
                      <button
                        type="button"
                        onClick={() => void handleLoadAllChatSpaces()}
                        disabled={isLoadingSpacesList}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-300 hover:text-violet-200 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${isLoadingSpacesList ? 'animate-spin' : ''}`}
                        />
                        <span>{isLoadingSpacesList ? 'Loading Spaces...' : 'Load All Spaces'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowChatAppSetup((v) => !v)}
                      className="text-[11px] text-slate-400 hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {showChatAppSetup ? 'Hide App Info' : 'App Info & Avatar'}
                    </button>
                    {workspaceBriefing.chatConsoleUrl && (
                      <a
                        href={workspaceBriefing.chatConsoleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-violet-300 whitespace-nowrap shrink-0"
                      >
                        <span>Chat API Console</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Guildhaven Chat App Identity & Avatar Helper (hidden by default) */}
                {showChatAppSetup && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={guildhavenAvatarImg}
                        alt="Guildhaven Google Chat avatar"
                        referrerPolicy="no-referrer"
                        className="h-14 w-14 rounded-xl border border-amber-500/40 object-cover shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs font-semibold text-white">
                          Guildhaven · Google Chat Avatar &amp; App Info
                        </p>
                        <p className="text-[11px] text-slate-400 leading-snug">
                          {publishedChatAvatarUrl
                            ? 'Your custom Guildhaven emblem is hosted publicly on Google Drive and ready to paste.'
                            : isPreviewSandbox
                              ? 'Preview URLs are private until deployed. Click "Host Custom Avatar on Drive" for a public URL of your Guildhaven crest, or copy the ready-to-use public URL below.'
                              : 'Use this public avatar URL and app metadata on the Google Cloud Chat API Configuration page.'}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {isGoogleConnected && !publishedChatAvatarUrl && isPreviewSandbox && (
                            <button
                              type="button"
                              disabled={isPublishingAvatar}
                              onClick={() => void handlePublishCustomAvatarToDrive()}
                              className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              {isPublishingAvatar ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <HardDrive className="h-3 w-3" />
                              )}
                              <span>
                                {isPublishingAvatar
                                  ? 'Hosting on Drive...'
                                  : 'Host Custom Avatar on Drive'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(chatAvatarUrl);
                              setWorkspaceNotice({
                                tone: 'ok',
                                text: 'Copied public Avatar URL to clipboard.',
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-950/40 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-950/70 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Copy className="h-3 w-3" />
                            <span>Copy Public Avatar URL</span>
                          </button>
                          <a
                            href={guildhavenAvatarImg}
                            download="guildhaven-chat-avatar.jpg"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                          >
                            <Download className="h-3 w-3" />
                            <span>Download .jpg</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(chatAppDescription);
                              setWorkspaceNotice({
                                tone: 'ok',
                                text: 'Copied Google Chat Description to clipboard.',
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span>Copy Description</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 font-mono text-[10px] text-slate-300 truncate">
                      {chatAvatarUrl}
                    </div>
                  </div>
                )}

                {/* Direct Open by URL, Space ID, Thread ID, or Room Name */}
                {workspaceBriefing.chatStatus === 'connected' && (
                  <form
                    onSubmit={(e) => void handleOpenSpecifiedChatSubmit(e)}
                    className="flex items-center gap-2"
                  >
                    <div className="relative flex-1 min-w-0">
                      <Link2 className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                      <input
                        type="text"
                        value={chatTargetInput}
                        onChange={(e) => setChatTargetInput(e.target.value)}
                        placeholder="Open specified chat or thread: paste Google Chat URL, spaces/AAAA..., spaces/.../threads/..., or room name"
                        className="w-full rounded-md border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-violet-400 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!chatTargetInput.trim() || isLoadingChatRead}
                      className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-violet-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {isLoadingChatRead ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5" />
                      )}
                      <span>Open Chat / Thread</span>
                    </button>
                  </form>
                )}

                {/* Pinned Chats Active Context Bar */}
                {pinnedChats.length > 0 && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-violet-200">
                        <Pin className="h-3 w-3 text-violet-300 shrink-0" />
                        <span>
                          Pinned to Daniel &amp; Village Context ({pinnedChats.length}) — all Houses can work with these transcripts
                        </span>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pinnedChats.map((pc) => (
                        <div
                          key={pc.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/90 px-2 py-1 text-[11px] text-slate-200"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveChatSpace({
                                name: pc.spaceName,
                                displayName: pc.spaceDisplayName,
                                spaceType: pc.spaceType,
                                recentMessages: pc.messages.slice(-5).reverse(),
                              });
                              setSelectedSpaceName(pc.spaceName);
                              setFocusedThreadName(pc.threadName ?? null);
                              setReplyThreadName(pc.threadName ?? null);
                              setLoadedMessages(
                                [...pc.messages].sort(
                                  (a, b) =>
                                    (Date.parse(a.createTime) || 0) -
                                    (Date.parse(b.createTime) || 0)
                                )
                              );
                              if (workspaceBriefing.chatStatus === 'connected') {
                                void loadChatConversation(pc.spaceName, {
                                  threadName: pc.threadName ?? null,
                                  silent: true,
                                });
                              }
                            }}
                            className="font-medium text-white hover:text-violet-300 cursor-pointer truncate max-w-[220px]"
                            title={`Open ${pc.label} (${pc.messages.length} messages)`}
                          >
                            {pc.label}
                          </button>
                          <span className="font-mono tabular-nums text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                            {pc.messages.length}m
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleUnpinChatSelection(pc.id, pc.label)}
                            title="Unpin from Village context"
                            aria-label={`Unpin ${pc.label}`}
                            className="text-slate-500 hover:text-rose-300 cursor-pointer shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Consent / Configuration / Main Workbench */}
              {workspaceBriefing.chatStatus === 'needs_consent' ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5 text-xs text-slate-300">
                  <p>Grant Google Chat permission to browse spaces, inspect threads, and send messages.</p>
                  <button
                    type="button"
                    onClick={() => void onGrantWorkspaceConsent()}
                    className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Grant Chat Access
                  </button>
                </div>
              ) : workspaceBriefing.chatStatus === 'app_not_configured' ? (
                <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-xs text-slate-300 leading-relaxed">
                  <p className="text-amber-300 font-medium">
                    {workspaceBriefing.chatStatusMessage ||
                      'Google Chat app not configured in Cloud Console yet.'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Enter App Name <strong className="text-slate-200">Guildhaven</strong>, paste the Avatar URL in App Info above, add the Description, and click Save in Cloud Console (Business or Enterprise Google Workspace required).
                  </p>
                  <a
                    href={
                      workspaceBriefing.chatConsoleUrl ||
                      'https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat'
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/50 bg-violet-950/60 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-950 whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Configure Google Chat App</span>
                  </a>
                </div>
              ) : workspaceBriefing.chatStatus === 'connected' ||
                  Boolean(activeChatSpace) ||
                  allKnownSpaces.length > 0 ||
                  pinnedChats.length > 0 ? (
                <>
                  {/* Collapsible Space Directory */}
                  {allKnownSpaces.length > 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1 overflow-x-auto">
                          {(
                            [
                              ['all', `All (${allKnownSpaces.length})`],
                              ['spaces', 'Spaces'],
                              ['dms', 'DMs & Groups'],
                              ['pinned', `Pinned (${pinnedChats.length})`],
                            ] as Array<[typeof spaceFilterMode, string]>
                          ).map(([modeId, label]) => (
                            <button
                              key={modeId}
                              type="button"
                              onClick={() => {
                                setSpaceFilterMode(modeId);
                                setShowSpaceDirectory(true);
                              }}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                spaceFilterMode === modeId
                                  ? 'bg-slate-800 text-white'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="relative w-44">
                            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                            <input
                              type="text"
                              value={spaceSearchQuery}
                              onChange={(e) => {
                                setSpaceSearchQuery(e.target.value);
                                setShowSpaceDirectory(true);
                              }}
                              placeholder="Filter spaces..."
                              aria-label="Filter Google Chat spaces"
                              className="w-full rounded border border-slate-800 bg-slate-900 pl-6 pr-2 py-1 text-[11px] text-white placeholder-slate-500 focus:border-violet-400 focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowSpaceDirectory((v) => !v)}
                            className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <span>{showSpaceDirectory ? 'Compact' : 'Spaces'}</span>
                            {showSpaceDirectory ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      {showSpaceDirectory && (
                        <>
                          {filteredSpaces.length === 0 ? (
                            <p className="text-xs text-slate-400 py-1">
                              {allKnownSpaces.length === 0
                                ? 'No Google Chat spaces returned yet. Paste a Google Chat URL or spaces/ID above to open any conversation directly.'
                                : 'No spaces match your current filter.'}
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                              {filteredSpaces.map((sp) => {
                                const isSelected = currentSpace?.name === sp.name;
                                const isSpacePinned = pinnedIds.has(sp.name);
                                const latest = sp.recentMessages[0];
                                return (
                                  <button
                                    key={sp.name}
                                    type="button"
                                    onClick={() => {
                                      setFocusedThreadName(null);
                                      setReplyThreadName(null);
                                      setActiveChatSpace(sp);
                                      setSelectedSpaceName(sp.name);
                                      setLoadedMessages([]);
                                      if (workspaceBriefing.chatStatus === 'connected') {
                                        void loadChatConversation(sp.name, { threadName: null });
                                      }
                                    }}
                                    className={`rounded-lg border p-2.5 text-left transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'border-violet-500/60 bg-violet-950/25'
                                        : 'border-slate-800 bg-slate-900/65 hover:border-slate-700'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="text-xs font-semibold text-white truncate">
                                        {sp.displayName}
                                      </span>
                                      <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-slate-400 font-mono">
                                        {isSpacePinned && (
                                          <Pin className="h-3 w-3 text-violet-300 shrink-0" />
                                        )}
                                        <span className="whitespace-nowrap">
                                          {formatSpaceTypeLabel(sp.spaceType)}
                                        </span>
                                      </div>
                                    </div>
                                    <p className="mt-1 text-[11px] text-slate-400 truncate">
                                      {latest
                                        ? `${latest.senderName}: ${latest.text}`
                                        : sp.name}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Read Chat: Active Space / Thread Reader, Keyword Search & Daniel Actions */}
                  {currentSpace && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
                      {/* Space / Thread Header */}
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800/90 pb-2.5">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] font-medium text-violet-300 whitespace-nowrap shrink-0">
                              Read Chat
                            </span>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <h3 className="text-sm font-bold text-white truncate">
                              {currentSpace.displayName}
                            </h3>
                            <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                              · {formatSpaceTypeLabel(currentSpace.spaceType)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                            <span className="truncate max-w-[260px]">{currentSpace.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(
                                  focusedThreadName || currentSpace.name
                                );
                                setWorkspaceNotice({
                                  tone: 'ok',
                                  text: `Copied ${
                                    focusedThreadName ? 'thread' : 'space'
                                  } ID to clipboard.`,
                                });
                              }}
                              className="inline-flex items-center gap-1 font-sans text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Copy className="h-3 w-3" />
                              <span>Copy ID</span>
                            </button>
                            <span aria-hidden="true">·</span>
                            <span>{threadFilteredMessages.length} msgs</span>
                            <span aria-hidden="true">·</span>
                            <span>{computedThreads.length} threads</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {chatNextPageToken && (
                            <button
                              type="button"
                              disabled={isLoadingOlderChat}
                              onClick={() =>
                                void loadChatConversation(currentSpace.name, {
                                  threadName: focusedThreadName,
                                  appendOlderPageToken: chatNextPageToken,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-violet-400 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              {isLoadingOlderChat && (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              )}
                              <span>Load Older</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isLoadingChatRead}
                            onClick={() =>
                              void loadChatConversation(currentSpace.name, {
                                threadName: focusedThreadName,
                              })
                            }
                            title="Refresh messages in this space/thread"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isLoadingChatRead ? 'animate-spin' : ''}`}
                            />
                            <span>Refresh</span>
                          </button>
                        </div>
                      </div>

                      {/* Work With This Chat / Thread Toolbar */}
                      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/75 p-2">
                        <button
                          type="button"
                          disabled={
                            pinningChatKey === activePinKey ||
                            (visibleMessages.length === 0 &&
                              currentSpace.recentMessages.length === 0)
                          }
                          onClick={() => {
                            if (isCurrentSelectionPinned) {
                              void handleUnpinChatSelection(activePinKey, activeContextLabel);
                            } else {
                              void handlePinChatSelection({
                                spaceName: currentSpace.name,
                                spaceDisplayName: currentSpace.displayName,
                                spaceType: currentSpace.spaceType,
                                threadName: focusedThreadName,
                                label: activeContextLabel,
                                messages:
                                  visibleMessages.length > 0
                                    ? visibleMessages
                                    : currentSpace.recentMessages,
                              });
                            }
                          }}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            isCurrentSelectionPinned
                              ? 'border-violet-400/60 bg-violet-950/60 text-violet-200'
                              : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-violet-400 hover:text-white'
                          }`}
                        >
                          {pinningChatKey === activePinKey ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Pin className="h-3 w-3 text-violet-300" />
                          )}
                          <span>
                            {isCurrentSelectionPinned ? 'Pinned to Context' : 'Pin to Context'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void triggerWorkWithDaniel('summarize')}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-950/35 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-950/70 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Sparkles className="h-3 w-3 text-amber-300" />
                          <span>Summarize</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void triggerWorkWithDaniel('actions')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <ListTodo className="h-3 w-3 text-sky-300" />
                          <span>Extract Actions</span>
                        </button>

                        {onPrefillTask && (
                          <button
                            type="button"
                            onClick={() => void triggerWorkWithDaniel('task')}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Send className="h-3 w-3 text-emerald-300" />
                            <span>Assign Task</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void triggerWorkWithDaniel('doc')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-blue-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <FileText className="h-3 w-3 text-blue-300" />
                          <span>Save to Doc</span>
                        </button>

                        {visibleMessages.length > 0 && (
                          <SpeakButton
                            variant="inline"
                            itemId={`ws_chat_active_${activePinKey}`}
                            label="Listen"
                            turn={{
                              agentId: 'daniel',
                              speakerName: danielAgent?.name ?? 'Daniel',
                              voiceName: danielAgent?.voiceName,
                              text: `Reading ${activeContextLabel}. ${visibleMessages
                                .slice(-8)
                                .map((m) => `${m.senderName} said: ${m.text}`)
                                .join('. ')}`,
                            }}
                          />
                        )}
                      </div>

                      {/* Focused Thread Breadcrumb Banner */}
                      {focusedThreadName && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-500/40 bg-violet-950/30 px-3 py-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <MessagesSquare className="h-3.5 w-3.5 text-violet-300 shrink-0" />
                            <span className="font-semibold text-violet-100 truncate">
                              Viewing Thread ({shortFocusedThread})
                            </span>
                            <span className="font-mono tabular-nums text-[11px] text-violet-200 whitespace-nowrap shrink-0">
                              · {visibleMessages.length} msg{visibleMessages.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setFocusedThreadName(null);
                              setReplyThreadName(null);
                              void loadChatConversation(currentSpace.name, { threadName: null });
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <ArrowLeft className="h-3 w-3" />
                            <span>All Space Messages</span>
                          </button>
                        </div>
                      )}

                      {/* Dedicated Keyword Search Bar + Messages / Threads Switcher */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1 min-w-0">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <input
                              type="text"
                              role="searchbox"
                              value={chatMessageFilter}
                              onChange={(e) => setChatMessageFilter(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape' && chatMessageFilter) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setChatMessageFilter('');
                                } else if (
                                  e.key === 'Enter' &&
                                  chatMessageFilter.trim() &&
                                  workspaceBriefing.chatStatus === 'connected'
                                ) {
                                  e.preventDefault();
                                  handleScanOlderHistory();
                                }
                              }}
                              placeholder={
                                focusedThreadName
                                  ? `Filter past messages in Thread ${shortFocusedThread} by keyword or sender...`
                                  : `Filter past messages in "${currentSpace.displayName}" by keyword or sender...`
                              }
                              aria-label={
                                focusedThreadName
                                  ? `Filter past messages in Thread ${shortFocusedThread} by keyword`
                                  : `Filter past messages in ${currentSpace.displayName} by keyword`
                              }
                              className="w-full rounded-md border border-slate-700 bg-slate-900 pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-400 focus:border-violet-400 focus:outline-none"
                            />
                            {chatMessageFilter && (
                              <button
                                type="button"
                                onClick={() => setChatMessageFilter('')}
                                title="Clear keyword filter (Esc)"
                                aria-label="Clear keyword filter"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          {workspaceBriefing.chatStatus === 'connected' &&
                            (hasActiveKeywordSearch || Boolean(chatNextPageToken)) && (
                              <button
                                type="button"
                                disabled={isLoadingOlderChat || isLoadingChatRead}
                                onClick={handleScanOlderHistory}
                                title="Fetch up to 100 older messages from Google Chat so keyword search covers deeper history"
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:border-violet-400 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                {isLoadingOlderChat ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Search className="h-3.5 w-3.5 text-violet-300" />
                                )}
                                <span>{isLoadingOlderChat ? 'Scanning...' : 'Scan History'}</span>
                              </button>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 p-0.5">
                            <button
                              type="button"
                              onClick={() => setChatViewMode('messages')}
                              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                chatViewMode === 'messages'
                                  ? 'bg-slate-800 text-white'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Messages ({visibleMessages.length}
                              {hasActiveKeywordSearch ? `/${threadFilteredMessages.length}` : ''})
                            </button>
                            <button
                              type="button"
                              onClick={() => setChatViewMode('threads')}
                              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                                chatViewMode === 'threads'
                                  ? 'bg-slate-800 text-violet-200'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <MessagesSquare className="h-3 w-3 text-violet-300" />
                              <span>Threads ({computedThreads.length})</span>
                            </button>
                          </div>

                          {hasActiveKeywordSearch && (
                            <div className="flex items-center gap-2 text-[11px] text-slate-300 font-mono tabular-nums">
                              <span>
                                {visibleMessages.length} of {threadFilteredMessages.length} msg
                                {threadFilteredMessages.length === 1 ? '' : 's'} matching &ldquo;
                                <span className="font-sans text-amber-200">
                                  {chatMessageFilter.trim()}
                                </span>
                                &rdquo;
                              </span>
                              <button
                                type="button"
                                onClick={() => setChatMessageFilter('')}
                                className="font-sans text-slate-400 hover:text-white underline cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Messages or Threads Viewport */}
                      {isLoadingChatRead ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
                          <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                          <span>Reading Google Chat conversation...</span>
                        </div>
                      ) : chatViewMode === 'threads' ? (
                        computedThreads.length === 0 ? (
                          <div className="py-6 text-center space-y-2 text-xs text-slate-400">
                            <p>
                              {hasActiveKeywordSearch
                                ? `No threads match "${chatMessageFilter.trim()}" in loaded history.`
                                : 'No threads found in this view.'}
                            </p>
                            {hasActiveKeywordSearch && (
                              <div className="flex items-center justify-center gap-2">
                                {workspaceBriefing.chatStatus === 'connected' && (
                                  <button
                                    type="button"
                                    disabled={isLoadingOlderChat}
                                    onClick={handleScanOlderHistory}
                                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-violet-200 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    {isLoadingOlderChat ? 'Scanning...' : 'Scan Older Messages'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setChatMessageFilter('')}
                                  className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  Clear Search
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                            {computedThreads.map((th) => {
                              const shortTh =
                                th.threadName.split('/').pop()?.slice(0, 10) || th.threadName;
                              const isThPinned = pinnedIds.has(th.threadName);
                              const latestReply =
                                th.messages.length > 1
                                  ? th.messages[th.messages.length - 1]
                                  : null;
                              return (
                                <div
                                  key={th.threadName}
                                  className="rounded-lg border border-slate-800 bg-slate-900/75 p-3 space-y-2 hover:border-slate-700 transition-colors"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-xs font-semibold text-white truncate">
                                        {renderHighlightedText(th.rootSenderName, chatMessageFilter)}
                                      </span>
                                      <span className="font-mono tabular-nums text-[11px] text-violet-300 whitespace-nowrap shrink-0">
                                        {th.messageCount} msg{th.messageCount === 1 ? '' : 's'}
                                        {th.replyCount > 0
                                          ? ` (${th.replyCount} repl${th.replyCount === 1 ? 'y' : 'ies'})`
                                          : ''}
                                      </span>
                                    </div>
                                    <span className="font-mono tabular-nums text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                                      {formatChatMsgTime(th.lastUpdateTime)}
                                    </span>
                                  </div>

                                  <p className="text-xs text-slate-200 whitespace-pre-wrap line-clamp-3">
                                    {renderHighlightedText(th.rootText, chatMessageFilter)}
                                  </p>

                                  {latestReply && (
                                    <div className="rounded border border-slate-800/90 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-slate-300">
                                      <span className="text-slate-400 font-medium">
                                        Latest (
                                        {renderHighlightedText(
                                          latestReply.senderName,
                                          chatMessageFilter
                                        )}
                                        ):
                                      </span>{' '}
                                      <span className="line-clamp-2">
                                        {renderHighlightedText(latestReply.text, chatMessageFilter)}
                                      </span>
                                    </div>
                                  )}

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
                                    <span className="text-slate-400 truncate max-w-[260px]">
                                      Participants: {th.participants.join(', ')}
                                    </span>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handlePinChatSelection({
                                            spaceName: currentSpace.name,
                                            spaceDisplayName: currentSpace.displayName,
                                            spaceType: currentSpace.spaceType,
                                            threadName: th.threadName,
                                            label: `${currentSpace.displayName} · Thread ${shortTh}`,
                                            messages: th.messages,
                                          })
                                        }
                                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                                          isThPinned
                                            ? 'border-violet-400/50 bg-violet-950/50 text-violet-200'
                                            : 'border-slate-700 bg-slate-950 text-slate-300 hover:text-white'
                                        }`}
                                      >
                                        <Pin className="h-3 w-3 text-violet-300" />
                                        <span>{isThPinned ? 'Pinned' : 'Pin Thread'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setFocusedThreadName(th.threadName);
                                          setReplyThreadName(th.threadName);
                                          setChatViewMode('messages');
                                          if (
                                            th.threadName.includes('/threads/') &&
                                            workspaceBriefing.chatStatus === 'connected'
                                          ) {
                                            void loadChatConversation(currentSpace.name, {
                                              threadName: th.threadName,
                                              silent: true,
                                            });
                                          }
                                        }}
                                        className="inline-flex items-center gap-1 rounded bg-violet-500 px-2.5 py-0.5 text-[11px] font-semibold text-slate-950 hover:bg-violet-400 cursor-pointer whitespace-nowrap shrink-0"
                                      >
                                        <MessagesSquare className="h-3 w-3" />
                                        <span>Open Thread</span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      ) : visibleMessages.length === 0 ? (
                        <div className="py-6 text-center space-y-2 text-xs text-slate-400">
                          <p>
                            {hasActiveKeywordSearch
                              ? `No messages match "${chatMessageFilter.trim()}" in the ${
                                  focusedThreadName ? 'active thread' : 'loaded space history'
                                }.`
                              : 'No text messages found in this space/thread yet.'}
                          </p>
                          {hasActiveKeywordSearch && (
                            <div className="flex items-center justify-center gap-2">
                              {workspaceBriefing.chatStatus === 'connected' && (
                                <button
                                  type="button"
                                  disabled={isLoadingOlderChat}
                                  onClick={handleScanOlderHistory}
                                  className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-violet-200 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  {isLoadingOlderChat ? 'Scanning...' : 'Scan Older Messages'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setChatMessageFilter('')}
                                className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Clear Search
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                          {visibleMessages.map((msg) => {
                            const msgThreadKey = msg.threadName || msg.name;
                            const threadTotal = replyCountByThread.get(msgThreadKey) ?? 1;
                            const shortTh = msg.threadName
                              ? msg.threadName.split('/').pop()?.slice(0, 8)
                              : null;

                            return (
                              <div
                                key={msg.name}
                                className="rounded-lg border border-slate-800 bg-slate-900/75 p-2.5 space-y-1.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-xs font-semibold text-white truncate">
                                      {renderHighlightedText(msg.senderName, chatMessageFilter)}
                                    </span>
                                    {msg.threadName && !focusedThreadName && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setFocusedThreadName(msg.threadName!);
                                          setReplyThreadName(msg.threadName!);
                                          if (workspaceBriefing.chatStatus === 'connected') {
                                            void loadChatConversation(currentSpace.name, {
                                              threadName: msg.threadName!,
                                              silent: true,
                                            });
                                          }
                                        }}
                                        title={`Inspect full thread (${msg.threadName})`}
                                        className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-slate-950 px-1.5 py-0.5 font-mono tabular-nums text-[10px] text-violet-300 hover:border-violet-400 cursor-pointer whitespace-nowrap shrink-0"
                                      >
                                        <MessagesSquare className="h-2.5 w-2.5" />
                                        <span>
                                          Thread {shortTh}
                                          {threadTotal > 1 ? ` · ${threadTotal}` : ''}
                                        </span>
                                      </button>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-mono tabular-nums text-[10px] text-slate-400 whitespace-nowrap">
                                      {formatChatMsgTime(msg.createTime)}
                                    </span>
                                    {msg.threadName && (
                                      <button
                                        type="button"
                                        onClick={() => setReplyThreadName(msg.threadName!)}
                                        title="Reply inside this thread"
                                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-violet-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                      >
                                        <Reply className="h-3 w-3" />
                                        <span>Reply</span>
                                      </button>
                                    )}
                                    {onAskDanielWithPrompt && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handlePinChatSelection({
                                            spaceName: currentSpace.name,
                                            spaceDisplayName: currentSpace.displayName,
                                            spaceType: currentSpace.spaceType,
                                            threadName: msg.threadName ?? focusedThreadName,
                                            label: activeContextLabel,
                                            messages: visibleMessages,
                                          });
                                          onAskDanielWithPrompt(
                                            `In Google Chat "${currentSpace.displayName}" (${currentSpace.name}${
                                              msg.threadName ? `, thread ${msg.threadName}` : ''
                                            }), ${msg.senderName} wrote: "${msg.text.slice(
                                              0,
                                              260
                                            )}". Help me analyze this and draft an appropriate follow-up.`
                                          );
                                        }}
                                        title="Work with this message in Daniel's chat"
                                        className="text-[10px] font-medium text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                                      >
                                        Ask Daniel
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed break-words">
                                  {renderHighlightedText(msg.text, chatMessageFilter)}
                                </p>

                                {((msg.attachmentNames && msg.attachmentNames.length > 0) ||
                                  (msg.reactionSummary && msg.reactionSummary.length > 0)) && (
                                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-slate-400">
                                    {(msg.attachmentNames ?? []).map((att, idx) => (
                                      <span
                                        key={`${msg.name}_att_${idx}`}
                                        className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-300"
                                      >
                                        Attachment: {att}
                                      </span>
                                    ))}
                                    {(msg.reactionSummary ?? []).map((rx, idx) => (
                                      <span
                                        key={`${msg.name}_rx_${idx}`}
                                        className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-slate-300"
                                      >
                                        {rx}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Thread-Aware Confirmation-Gated Reply Composer */}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!currentSpace || !chatMessageDraft.trim()) return;
                          setPendingChatConfirm({
                            spaceName: currentSpace.name,
                            spaceLabel: currentSpace.displayName,
                            threadName: replyThreadName || undefined,
                            text: chatMessageDraft.trim(),
                          });
                        }}
                        className="space-y-2 pt-2.5 border-t border-slate-800"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="text-slate-400 truncate">
                            Posting to{' '}
                            <strong className="font-semibold text-slate-200">
                              {currentSpace.displayName}
                            </strong>
                            {replyThreadName && (
                              <span className="font-mono text-violet-300">
                                {' '}
                                · in thread ({replyThreadName.split('/').pop()?.slice(0, 10)})
                              </span>
                            )}
                          </span>
                          {replyThreadName && (
                            <button
                              type="button"
                              onClick={() => setReplyThreadName(null)}
                              className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Switch to new space post
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={chatMessageDraft}
                            onChange={(e) => setChatMessageDraft(e.target.value)}
                            placeholder={
                              replyThreadName
                                ? 'Write a reply in this thread (requires confirmation)...'
                                : `Write a message to ${currentSpace.displayName} (requires confirmation)...`
                            }
                            className="flex-1 min-w-0 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-violet-400 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={!chatMessageDraft.trim()}
                            className="inline-flex items-center gap-1 rounded-md bg-violet-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-violet-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Send className="h-3.5 w-3.5" />
                            <span>{replyThreadName ? 'Reply in Thread' : 'Send'}</span>
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs text-slate-400">
                    {workspaceBriefing.chatStatusMessage ||
                      'Google Chat requires a Business or Enterprise Google Workspace account.'}
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {activeTab === 'docs' && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-semibold text-blue-300 tabular-nums">
                <FileText className="h-4 w-4" />
                <span>Linked Google Docs ({linkedDocs.length})</span>
              </p>
              <button
                type="button"
                onClick={() => setShowNewDocForm((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-blue-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                <FilePlus2 className="h-3.5 w-3.5 text-blue-400" />
                <span>{showNewDocForm ? 'Close' : 'New Doc'}</span>
              </button>
            </div>

            <form onSubmit={(e) => void handleLinkDocSubmit(e)} className="flex items-center gap-2">
              <input
                type="text"
                value={docUrlInput}
                onChange={(e) => setDocUrlInput(e.target.value)}
                placeholder="Paste Google Docs URL or Document ID..."
                className="flex-1 min-w-0 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isImportingDoc || !docUrlInput.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Link2 className="h-3.5 w-3.5 text-blue-400" />
                <span>{isImportingDoc ? 'Reading...' : 'Link Doc'}</span>
              </button>
            </form>

            {showNewDocForm && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newDocTitle.trim()) return;
                  setPendingDocConfirm({
                    title: newDocTitle.trim(),
                    content: newDocBody.trim(),
                  });
                }}
                className="rounded-lg border border-slate-700 bg-slate-900/80 p-3 space-y-2.5"
              >
                <input
                  type="text"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="New Google Doc title..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <textarea
                  rows={4}
                  value={newDocBody}
                  onChange={(e) => setNewDocBody(e.target.value)}
                  placeholder="Initial document content (optional)..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!newDocTitle.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-blue-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    <span>Create Google Doc</span>
                  </button>
                </div>
              </form>
            )}

            {linkedDocs.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">
                Paste any Google Docs link above so villagers can read and reference it, or export finished deliverables from Reports.
              </p>
            ) : (
              <div className="space-y-2">
                {linkedDocs.map((doc) => (
                  <div
                    key={doc.documentId}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-300 hover:underline truncate"
                      >
                        <span className="truncate">{doc.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <SpeakButton
                          variant="inline"
                          itemId={`ws_doc_listen_${doc.documentId}`}
                          label="Listen"
                          turn={{
                            agentId: 'daniel',
                            speakerName: danielAgent?.name ?? 'Daniel',
                            voiceName: danielAgent?.voiceName,
                            text: `${doc.title}. ${doc.content || doc.excerpt}`,
                            maxChars: 2000,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void onUnlinkGoogleDoc(doc.documentId)}
                          title="Unlink from village (does not delete from Google Docs)"
                          aria-label="Unlink from village"
                          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{doc.excerpt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'drive' && (
          <div className="space-y-4">
            {/* Designated Working Folder Header + Explorer */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/65 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderCheck className="h-4 w-4 text-orange-400 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-white truncate">
                      Working Folder: {workingFolder ? workingFolder.name : 'Not Configured'}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {workingFolder
                        ? 'Browse, create, read, edit, or move files inside your designated Drive workspace.'
                        : 'Set a Working Folder in Settings → Guardrails to unlock the full folder file editor.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {workingFolder?.webViewLink && (
                    <a
                      href={workingFolder.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-orange-300 hover:border-orange-500/60 whitespace-nowrap shrink-0"
                    >
                      <span>Open in Drive</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenSettings('guardrails')}
                    className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {workingFolder ? 'Change Folder' : 'Configure Folder'}
                  </button>
                </div>
              </div>

              {workingFolder && isGoogleConnected && workspaceBriefing.driveStatus !== 'needs_consent' && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                    <div className="flex flex-wrap items-center gap-1 text-xs min-w-0">
                      {breadcrumbs.map((crumb, idx) => {
                        const isLast = idx === breadcrumbs.length - 1;
                        return (
                          <React.Fragment key={crumb.id}>
                            {idx > 0 && (
                              <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                            )}
                            <button
                              type="button"
                              disabled={isLast}
                              onClick={() => {
                                setBreadcrumbs((prev) => prev.slice(0, idx + 1));
                                setSelectedFile(null);
                              }}
                              className={`truncate max-w-[160px] ${
                                isLast
                                  ? 'font-semibold text-white cursor-default'
                                  : 'text-orange-300 hover:underline cursor-pointer'
                              }`}
                            >
                              {crumb.name}
                            </button>
                          </React.Fragment>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setShowCreateWorkingForm((prev) => (prev === 'file' ? 'none' : 'file'))
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <FilePlus2 className="h-3 w-3 text-orange-400" />
                        <span>New File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setShowCreateWorkingForm((prev) =>
                            prev === 'folder' ? 'none' : 'folder'
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <FolderPlus className="h-3 w-3 text-orange-400" />
                        <span>New Folder</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadExplorerItems(currentExplorerFolderId, explorerQuery)}
                        disabled={isLoadingExplorer}
                        aria-label="Refresh Working Folder"
                        className="rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:text-white cursor-pointer shrink-0"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${isLoadingExplorer ? 'animate-spin' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void loadExplorerItems(currentExplorerFolderId, explorerQuery);
                    }}
                    className="flex items-center gap-2"
                  >
                    <div className="relative flex-1 min-w-0">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                      <input
                        type="text"
                        value={explorerQuery}
                        onChange={(e) => setExplorerQuery(e.target.value)}
                        placeholder="Filter files inside this Working Folder..."
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                    {explorerQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setExplorerQuery('');
                          void loadExplorerItems(currentExplorerFolderId, '');
                        }}
                        className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </form>

                  {showCreateWorkingForm !== 'none' && (
                    <form
                      onSubmit={(e) => void handleCreateItemInWorkingFolder(e)}
                      className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-white">
                          {showCreateWorkingForm === 'folder'
                            ? 'New Subfolder in Working Folder'
                            : 'New File in Working Folder'}
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowCreateWorkingForm('none')}
                          className="text-slate-400 hover:text-white cursor-pointer"
                          aria-label="Cancel new item"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder={
                          showCreateWorkingForm === 'folder'
                            ? 'Subfolder name...'
                            : 'File name (e.g. sprint-notes.md, config.json)...'
                        }
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                      />
                      {showCreateWorkingForm === 'file' && (
                        <textarea
                          rows={4}
                          value={newItemContent}
                          onChange={(e) => setNewItemContent(e.target.value)}
                          placeholder="Write initial file content..."
                          className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                        />
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowCreateWorkingForm('none')}
                          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isCreatingItem || !newItemName.trim()}
                          className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-50 cursor-pointer"
                        >
                          {isCreatingItem && <Loader2 className="h-3 w-3 animate-spin" />}
                          <span>
                            {showCreateWorkingForm === 'folder' ? 'Create Folder' : 'Create File'}
                          </span>
                        </button>
                      </div>
                    </form>
                  )}

                  {isLoadingExplorer ? (
                    <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" />
                      <span>Loading Working Folder files...</span>
                    </div>
                  ) : folderItems.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-500">
                      This folder is empty. Create a file or subfolder above, or save deliverables from Reports.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-slate-900/70">
                      {folderItems.map((item) => {
                        const isSelected = selectedFile?.id === item.id;
                        const sizeLabel = formatFileSize(item.size);
                        const dateLabel = formatShortDate(item.modifiedTime);
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between gap-3 px-3 py-2 transition-colors ${
                              isSelected ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void handleOpenWorkingItem(item)}
                              className="flex flex-1 items-center gap-2.5 text-left min-w-0 cursor-pointer"
                            >
                              {item.isFolder ? (
                                <Folder className="h-4 w-4 text-orange-400 shrink-0" />
                              ) : (
                                <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-100 truncate">
                                  {item.name}
                                </p>
                                {(dateLabel || sizeLabel) && (
                                  <p className="text-[11px] text-slate-500 tabular-nums truncate">
                                    {[dateLabel, sizeLabel].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                              </div>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              {!item.isFolder && (
                                <button
                                  type="button"
                                  onClick={() => void handleOpenWorkingItem(item)}
                                  title="Read & Edit file"
                                  aria-label={`Read or edit ${item.name}`}
                                  className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-amber-300 cursor-pointer"
                                >
                                  <PencilLine className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <a
                                href={item.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                title="Open in Google Drive"
                                aria-label={`Open ${item.name} in Google Drive`}
                                className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-orange-300"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                              <button
                                type="button"
                                onClick={() => setPendingTrashItem(item)}
                                title="Move to Google Drive Trash"
                                aria-label={`Move ${item.name} to Trash`}
                                className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isReadingFile && (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      <span>Reading file content from Google Drive...</span>
                    </div>
                  )}

                  {selectedFile && !isReadingFile && (
                    <form
                      onSubmit={(e) => void handleSaveEditedFile(e)}
                      className="rounded-lg border border-slate-700 bg-slate-900 p-3.5 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">
                          File Viewer &amp; Editor
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            setReadOnlyExternalNotice(null);
                          }}
                          className="text-xs text-slate-400 hover:text-white cursor-pointer"
                        >
                          Close
                        </button>
                      </div>

                      {readOnlyExternalNotice && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-950/35 p-3 space-y-2">
                          <p className="text-xs text-amber-200 leading-relaxed">
                            {readOnlyExternalNotice}
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleSaveEditableCopy()}
                            disabled={isCopyingEditable}
                            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
                          >
                            <CopyPlus className="h-3.5 w-3.5" />
                            <span>
                              {isCopyingEditable
                                ? 'Saving Copy...'
                                : 'Save Editable Copy in Working Folder'}
                            </span>
                          </button>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="block text-[11px] font-medium text-slate-400">
                          File Name
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[11px] font-medium text-slate-400">
                          Content
                        </label>
                        <textarea
                          rows={7}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs leading-relaxed text-slate-100 focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={selectedFile.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-orange-300 hover:underline"
                        >
                          <span>Open original in Drive</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <button
                          type="submit"
                          disabled={isSavingFile}
                          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
                        >
                          {isSavingFile && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <span>{isSavingFile ? 'Saving...' : 'Save Changes'}</span>
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>

            {/* Global Drive Search, Context Pinning & Upload */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-semibold text-orange-300 tabular-nums">
                  <HardDrive className="h-4 w-4" />
                  <span>
                    Google Drive Search &amp; Context ({(driveSearchResults ?? driveFiles).length})
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowNewDriveForm((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FolderPlus className="h-3 w-3 text-orange-400" />
                  <span>{showNewDriveForm ? 'Close' : 'Save File / Folder'}</span>
                </button>
              </div>

              <form onSubmit={(e) => void handleDriveSearchOrPinSubmit(e)} className="flex items-center gap-2">
                <input
                  type="text"
                  value={driveSearchInput}
                  onChange={(e) => setDriveSearchInput(e.target.value)}
                  placeholder="Search Drive files or paste file/folder URL to pin..."
                  className="flex-1 min-w-0 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSearchingDrive || Boolean(pinningDriveId)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {looksLikeDriveUrl(driveSearchInput.trim()) ? (
                    <>
                      <Pin className="h-3 w-3 text-orange-400" />
                      <span>{pinningDriveId ? 'Pinning...' : 'Pin URL'}</span>
                    </>
                  ) : (
                    <>
                      <Search className="h-3 w-3 text-orange-400" />
                      <span>{isSearchingDrive ? 'Searching...' : 'Search'}</span>
                    </>
                  )}
                </button>
              </form>

              {(driveSearchResults !== null || activeDriveFolderName) && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span className="truncate">
                    {activeDriveFolderName ? `Folder: ${activeDriveFolderName}` : 'Drive search results'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDriveSearchResults(null);
                      setActiveDriveFolderId(null);
                      setActiveDriveFolderName(null);
                      setDriveSearchInput('');
                    }}
                    className="text-orange-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Back to recent
                  </button>
                </div>
              )}

              {showNewDriveForm && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newDriveName.trim()) return;
                    setPendingDriveConfirm({
                      name: newDriveName.trim(),
                      content: newDriveContent.trim(),
                      isFolder: newDriveIsFolder,
                      parentFolderId: activeDriveFolderId ?? workingFolder?.id ?? undefined,
                      parentFolderName: activeDriveFolderName ?? workingFolder?.name ?? null,
                    });
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNewDriveIsFolder(false)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                        !newDriveIsFolder
                          ? 'bg-orange-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      Markdown / Text File
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewDriveIsFolder(true)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                        newDriveIsFolder
                          ? 'bg-orange-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      Folder
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newDriveName}
                    onChange={(e) => setNewDriveName(e.target.value)}
                    placeholder={
                      newDriveIsFolder
                        ? 'New Drive folder name...'
                        : 'File name (e.g. Q2-Strategy-Brief.md)...'
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                  {!newDriveIsFolder && (
                    <textarea
                      rows={3}
                      value={newDriveContent}
                      onChange={(e) => setNewDriveContent(e.target.value)}
                      placeholder="File content to upload to Google Drive..."
                      className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400 truncate">
                      {activeDriveFolderName
                        ? `Inside: ${activeDriveFolderName}`
                        : workingFolder
                          ? `Inside Working Folder: ${workingFolder.name}`
                          : 'Location: My Drive root'}
                    </span>
                    <button
                      type="submit"
                      disabled={!newDriveName.trim()}
                      className="inline-flex items-center gap-1 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                      <span>{newDriveIsFolder ? 'Create Folder' : 'Save to Drive'}</span>
                    </button>
                  </div>
                </form>
              )}

              {pinnedDriveFiles.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-medium text-orange-300/90 tabular-nums">
                    Pinned in Village Context ({pinnedDriveFiles.length})
                  </p>
                  {pinnedDriveFiles.map((pf) => (
                    <div
                      key={`pin_${pf.id}`}
                      className="rounded-lg border border-orange-500/30 bg-slate-900/80 px-3 py-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={pf.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-200 hover:underline truncate"
                        >
                          {pf.isFolder ? (
                            <Folder className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                          )}
                          <span className="truncate">{pf.name}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <SpeakButton
                            variant="inline"
                            itemId={`ws_drive_listen_${pf.id}`}
                            label="Listen"
                            turn={{
                              agentId: 'daniel',
                              speakerName: danielAgent?.name ?? 'Daniel',
                              voiceName: danielAgent?.voiceName,
                              text: `${pf.name}. ${pf.content || pf.excerpt || ''}`,
                              maxChars: 2000,
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => void onUnpinDriveFile(pf.id)}
                            title="Unpin from village context"
                            aria-label="Unpin from village context"
                            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {pf.excerpt && (
                        <p className="text-[11px] text-slate-400 line-clamp-2">{pf.excerpt}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(driveSearchResults ?? driveFiles).length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No matching Google Drive items found. Search above or save deliverables from Reports.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(driveSearchResults ?? driveFiles).slice(0, 8).map((f) => {
                    const alreadyPinned = pinnedDriveFiles.some((pf) => pf.id === f.id);
                    return (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/90 bg-slate-900/70 px-3 py-2"
                      >
                        <a
                          href={f.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-slate-200 hover:text-orange-300 truncate min-w-0"
                        >
                          {f.isFolder ? (
                            <Folder className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="truncate">{f.name}</span>
                        </a>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {f.isFolder && (
                            <button
                              type="button"
                              onClick={() => void handleBrowseDriveFolder(f)}
                              className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Open
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={alreadyPinned || pinningDriveId === f.id}
                            onClick={() => void handlePinDriveItem(f.id, f.name)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-orange-300 hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Pin className="h-2.5 w-2.5" />
                            <span>
                              {alreadyPinned
                                ? 'Pinned'
                                : pinningDriveId === f.id
                                  ? 'Reading...'
                                  : 'Pin'}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modals */}
      {pendingCalendarConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div
              className={`flex items-center gap-2 ${
                pendingCalendarConfirm.action === 'delete' ? 'text-rose-400' : 'text-sky-300'
              }`}
            >
              {pendingCalendarConfirm.action === 'delete' ? (
                <ShieldAlert className="h-5 w-5" />
              ) : (
                <CalendarPlus className="h-5 w-5" />
              )}
              <h3 className="text-sm font-bold text-white">
                {pendingCalendarConfirm.action === 'create'
                  ? 'Create Google Calendar Event?'
                  : pendingCalendarConfirm.action === 'update'
                    ? 'Update Google Calendar Event?'
                    : 'Delete Google Calendar Event?'}
              </h3>
            </div>
            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
              <p>
                {pendingCalendarConfirm.action === 'create'
                  ? `Add "${pendingCalendarConfirm.summary}" to your primary Google Calendar?`
                  : pendingCalendarConfirm.action === 'update'
                    ? `Save changes to "${pendingCalendarConfirm.summary}" on your primary Google Calendar?`
                    : `Permanently delete "${pendingCalendarConfirm.summary}" from your primary Google Calendar?`}
              </p>
              {pendingCalendarConfirm.start && (
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-200 space-y-1">
                  <p className="tabular-nums">
                    <span className="text-slate-400">When:</span>{' '}
                    {formatCalendarTimestamp(toLocalIsoWithOffset(pendingCalendarConfirm.start))}
                    {pendingCalendarConfirm.end
                      ? ` – ${formatCalendarTimestamp(toLocalIsoWithOffset(pendingCalendarConfirm.end))}`
                      : ''}
                  </p>
                  {pendingCalendarConfirm.location && (
                    <p>
                      <span className="text-slate-400">Location:</span>{' '}
                      {pendingCalendarConfirm.location}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCalendarConfirm(null)}
                disabled={isMutatingCalendar}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCalendarMutation()}
                disabled={isMutatingCalendar}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                  pendingCalendarConfirm.action === 'delete'
                    ? 'bg-rose-500 text-white hover:bg-rose-400'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                }`}
              >
                {isMutatingCalendar
                  ? 'Saving...'
                  : pendingCalendarConfirm.action === 'delete'
                    ? 'Delete Event'
                    : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingChatConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-violet-300">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">
                {pendingChatConfirm.threadName
                  ? 'Reply in Google Chat Thread?'
                  : 'Send Google Chat Message?'}
              </h3>
            </div>
            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
              <p>
                {pendingChatConfirm.threadName ? 'Post this reply inside thread in ' : 'Post this message to '}
                <strong className="font-semibold text-white">{pendingChatConfirm.spaceLabel}</strong>{' '}
                in Google Chat?
              </p>
              {pendingChatConfirm.threadName && (
                <p className="font-mono tabular-nums text-[10px] text-violet-300 truncate">
                  Thread: {pendingChatConfirm.threadName}
                </p>
              )}
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-200 whitespace-pre-wrap">
                {pendingChatConfirm.text}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingChatConfirm(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmChatSend()}
                disabled={isSendingChat}
                className="rounded-md bg-violet-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-violet-400 disabled:opacity-50 cursor-pointer"
              >
                {isSendingChat ? 'Sending...' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDocConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-blue-300">
              <FilePlus2 className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">Create New Google Doc?</h3>
            </div>
            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
              <p>
                Create a new Google Doc titled{' '}
                <strong className="font-semibold text-white">
                  &ldquo;{pendingDocConfirm.title}&rdquo;
                </strong>{' '}
                in your Google Docs account?
              </p>
              {pendingDocConfirm.content && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-200 whitespace-pre-wrap">
                  {pendingDocConfirm.content}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDocConfirm(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCreateDoc()}
                disabled={isCreatingDoc}
                className="rounded-md bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-blue-400 disabled:opacity-50 cursor-pointer"
              >
                {isCreatingDoc ? 'Creating...' : 'Confirm & Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDriveConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-orange-300">
              <HardDrive className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">
                {pendingDriveConfirm.isFolder
                  ? 'Create Google Drive Folder?'
                  : 'Save File to Google Drive?'}
              </h3>
            </div>
            <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
              <p>
                {pendingDriveConfirm.isFolder
                  ? `Create folder "${pendingDriveConfirm.name}" in ${pendingDriveConfirm.parentFolderName || 'your Google Drive'}?`
                  : `Save file "${pendingDriveConfirm.name}" to ${pendingDriveConfirm.parentFolderName || 'your Google Drive'}?`}
              </p>
              {!pendingDriveConfirm.isFolder && pendingDriveConfirm.content && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-200 whitespace-pre-wrap">
                  {pendingDriveConfirm.content}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDriveConfirm(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSaveDrive()}
                disabled={isSavingDrive}
                className="rounded-md bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-50 cursor-pointer"
              >
                {isSavingDrive ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingTrashItem && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Move to Google Drive Trash?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Move{' '}
              <strong className="font-semibold text-white">
                &ldquo;{pendingTrashItem.name}&rdquo;
              </strong>{' '}
              to Google Drive Trash? You can still recover trashed items from Google Drive&apos;s Trash folder.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingTrashItem(null)}
                disabled={isTrashing}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmTrash()}
                disabled={isTrashing}
                className="rounded-md bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50 cursor-pointer"
              >
                {isTrashing ? 'Moving to Trash...' : 'Move to Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
