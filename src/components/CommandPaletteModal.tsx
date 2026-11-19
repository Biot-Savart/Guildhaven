import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  BookOpen,
  Building2,
  Calendar,
  Compass,
  FileText,
  HardDrive,
  LayoutGrid,
  Mail,
  Map as MapIcon,
  MessageSquare,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  X,
} from 'lucide-react';
import { VILLAGE_BUILDINGS } from '../data/villageWorld';
import type {
  Agent,
  ApprovalItem,
  Building,
  KnowledgeEntry,
  VillageTask,
} from '../types/village';
import type { WorkspaceTab } from './WorkspaceHubDrawer';

interface CommandPaletteModalProps {
  isOpen: boolean;
  workspaceViewMode: 'map' | 'desk';
  agents: Agent[];
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  knowledgeBase: KnowledgeEntry[];
  onClose: () => void;
  onOpenMorningBriefing: () => void;
  onToggleViewMode: (mode: 'map' | 'desk') => void;
  onAssignToDirector: (director: Agent) => void;
  onOpenAgentChat: (agent: Agent) => void;
  onEnterBuilding: (building: Building) => void;
  onOpenWorkspaceTab: (tab: WorkspaceTab) => void;
  onOpenReports: (task?: VillageTask) => void;
  onOpenApprovals: () => void;
  onOpenKnowledge: (department?: string) => void;
  onOpenSettings: () => void;
  onOpenAutopilotSettings?: () => void;
}

interface PaletteCommandItem {
  id: string;
  section: string;
  title: string;
  subtitle: string;
  keywords: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  workspaceViewMode,
  agents,
  tasks,
  approvals,
  knowledgeBase,
  onClose,
  onOpenMorningBriefing,
  onToggleViewMode,
  onAssignToDirector,
  onOpenAgentChat,
  onEnterBuilding,
  onOpenWorkspaceTab,
  onOpenReports,
  onOpenApprovals,
  onOpenKnowledge,
  onOpenSettings,
  onOpenAutopilotSettings,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const allItems = useMemo<PaletteCommandItem[]>(() => {
    const items: PaletteCommandItem[] = [];
    const pendingApprovals = approvals.filter((a) => a.status === 'pending');

    items.push({
      id: 'act_morning_briefing',
      section: 'Quick Actions',
      title: 'Morning Briefing (Written + Voice)',
      subtitle: 'Synthesize Gmail, Calendar, Chat, Tasks & Pending Approvals',
      keywords: 'morning briefing summary listen audio daily digest overview',
      icon: <Sun className="h-4 w-4 text-amber-400" />,
      onSelect: () => {
        onClose();
        onOpenMorningBriefing();
      },
    });

    items.push({
      id: 'act_switch_view',
      section: 'Quick Actions',
      title:
        workspaceViewMode === 'map'
          ? 'Switch to Desk View (Executive Board)'
          : 'Switch to 2.5D Village Map View',
      subtitle:
        workspaceViewMode === 'map'
          ? 'View all 8 Guilds, Approvals, Tasks & Workspace on one screen'
          : 'Return to the interactive 2.5D Guildhaven village map',
      keywords: 'desk board dashboard map switch toggle view mode',
      icon:
        workspaceViewMode === 'map' ? (
          <LayoutGrid className="h-4 w-4 text-sky-400" />
        ) : (
          <MapIcon className="h-4 w-4 text-emerald-400" />
        ),
      onSelect: () => {
        onClose();
        onToggleViewMode(workspaceViewMode === 'map' ? 'desk' : 'map');
      },
    });

    const townHall = VILLAGE_BUILDINGS.find((b) => b.id === 'town_hall');
    if (townHall) {
      items.push({
        id: 'act_town_hall',
        section: 'Quick Actions',
        title: 'Enter Town Hall Roundtable & Hiring',
        subtitle: 'Convene all Directors or interview specialist candidates',
        keywords: 'town hall council meeting roundtable hire interview',
        icon: <Building2 className="h-4 w-4 text-amber-400" />,
        onSelect: () => {
          onClose();
          onEnterBuilding(townHall);
        },
      });
    }

    if (pendingApprovals.length > 0) {
      items.push({
        id: 'act_pending_approvals',
        section: 'Quick Actions',
        title: `Review Pending Approvals (${pendingApprovals.length})`,
        subtitle: 'Edit inline or confirm staged drafts, events, chats & docs',
        keywords: 'approvals pending confirm edit sign off',
        icon: <ShieldAlert className="h-4 w-4 text-amber-400" />,
        onSelect: () => {
          onClose();
          onOpenApprovals();
        },
      });
    }

    // Direct @Director Assignment
    const directors = agents.filter((a) => a.role === 'director');
    for (const dir of directors) {
      items.push({
        id: `assign_${dir.id}`,
        section: 'Direct @Director Assignment',
        title: `Assign Task Directly to @${dir.name}`,
        subtitle: `${dir.department} · ${dir.title}`,
        keywords: `@${dir.name.toLowerCase()} assign task direct ${dir.department.toLowerCase()} ${dir.title.toLowerCase()}`,
        icon: <AtSign className="h-4 w-4 text-amber-400" />,
        onSelect: () => {
          onClose();
          onAssignToDirector(dir);
        },
      });
    }

    // Google Workspace Hubs
    const wsTabs: Array<{ tab: WorkspaceTab; title: string; subtitle: string; icon: React.ReactNode }> = [
      {
        tab: 'overview',
        title: 'Google Workspace · Gmail & Overview',
        subtitle: 'Read inbox messages and Workspace status',
        icon: <Mail className="h-4 w-4 text-emerald-400" />,
      },
      {
        tab: 'calendar',
        title: 'Google Workspace · Calendar',
        subtitle: 'View schedule or create/edit events',
        icon: <Calendar className="h-4 w-4 text-sky-400" />,
      },
      {
        tab: 'chat',
        title: 'Google Workspace · Google Chat Spaces',
        subtitle: 'Read spaces and send updates',
        icon: <MessageSquare className="h-4 w-4 text-violet-400" />,
      },
      {
        tab: 'docs',
        title: 'Google Workspace · Google Docs',
        subtitle: 'Link reference Docs or create new deliverables',
        icon: <FileText className="h-4 w-4 text-blue-400" />,
      },
      {
        tab: 'drive',
        title: 'Google Workspace · Drive Working Folder',
        subtitle: 'Browse, create, and edit files in your Working Folder',
        icon: <HardDrive className="h-4 w-4 text-orange-400" />,
      },
    ];
    for (const w of wsTabs) {
      items.push({
        id: `ws_${w.tab}`,
        section: 'Google Workspace',
        title: w.title,
        subtitle: w.subtitle,
        keywords: `workspace google ${w.tab} ${w.title.toLowerCase()}`,
        icon: w.icon,
        onSelect: () => {
          onClose();
          onOpenWorkspaceTab(w.tab);
        },
      });
    }

    items.push({
      id: 'settings_autopilot',
      section: 'Quick Actions',
      title: 'Autopilot Rules & Cron Schedules',
      subtitle: 'Toggle automation rules, edit cron schedules & run manual tests',
      keywords: 'autopilot automation rules cron schedule webhook test run now settings',
      icon: <Settings className="h-4 w-4 text-amber-400" />,
      onSelect: () => {
        onClose();
        if (onOpenAutopilotSettings) {
          onOpenAutopilotSettings();
        } else {
          onOpenSettings();
        }
      },
    });

    items.push({
      id: 'settings_guardrails',
      section: 'Google Workspace',
      title: 'Workspace Guardrails & Settings',
      subtitle: 'Configure Working Folder, Calendar Write Access & Audio',
      keywords: 'settings guardrails permissions calendar write working folder audio 4k',
      icon: <Settings className="h-4 w-4 text-slate-300" />,
      onSelect: () => {
        onClose();
        onOpenSettings();
      },
    });

    // Villagers (Chat & Voice)
    const chatAgents = agents.filter((a) => a.id !== 'cho');
    for (const ag of chatAgents) {
      items.push({
        id: `chat_${ag.id}`,
        section: 'Talk to Villager',
        title: `Chat or Voice Call with ${ag.name}`,
        subtitle: `${ag.title} · ${ag.department}`,
        keywords: `talk chat call voice ${ag.name.toLowerCase()} ${ag.department.toLowerCase()} ${ag.title.toLowerCase()}`,
        icon: <MessageSquare className="h-4 w-4 text-sky-400" />,
        onSelect: () => {
          onClose();
          onOpenAgentChat(ag);
        },
      });
    }

    // Guild Buildings
    for (const b of VILLAGE_BUILDINGS) {
      items.push({
        id: `bldg_${b.id}`,
        section: 'Guild Houses',
        title: `Enter ${b.name}`,
        subtitle: b.subtitle,
        keywords: `enter building house guild ${b.name.toLowerCase()} ${b.subtitle.toLowerCase()}`,
        icon: <Compass className="h-4 w-4 text-amber-300" />,
        onSelect: () => {
          onClose();
          onEnterBuilding(b);
        },
      });
    }

    // Recent Deliverables
    for (const t of tasks.filter((x) => !x.archived).slice(0, 8)) {
      items.push({
        id: `task_${t.id}`,
        section: 'Recent Reports',
        title: t.prompt.length > 68 ? `${t.prompt.slice(0, 65)}...` : t.prompt,
        subtitle: `${t.assignedDirectorName} · ${t.status === 'completed' ? 'Completed' : 'Active'}`,
        keywords: `report deliverable task ${t.prompt.toLowerCase()} ${t.assignedDirectorName.toLowerCase()}`,
        icon: <FileText className="h-4 w-4 text-emerald-400" />,
        onSelect: () => {
          onClose();
          onOpenReports(t);
        },
      });
    }

    // Knowledge Base SOPs
    for (const kb of knowledgeBase.slice(0, 8)) {
      items.push({
        id: `kb_${kb.id}`,
        section: 'Knowledge Base',
        title: `[${kb.code}] ${kb.title}`,
        subtitle: kb.department,
        keywords: `knowledge sop wiki ${kb.code.toLowerCase()} ${kb.title.toLowerCase()} ${kb.department.toLowerCase()}`,
        icon: <BookOpen className="h-4 w-4 text-sky-300" />,
        onSelect: () => {
          onClose();
          onOpenKnowledge(kb.department);
        },
      });
    }

    return items;
  }, [
    agents,
    approvals,
    knowledgeBase,
    onAssignToDirector,
    onClose,
    onEnterBuilding,
    onOpenAgentChat,
    onOpenApprovals,
    onOpenKnowledge,
    onOpenMorningBriefing,
    onOpenReports,
    onOpenSettings,
    onOpenAutopilotSettings,
    onOpenWorkspaceTab,
    onToggleViewMode,
    tasks,
    workspaceViewMode,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 18);
    return allItems
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.keywords.includes(q)
      )
      .slice(0, 24);
  }, [allItems, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredItems[activeIndex];
      if (target) {
        target.onSelect();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 pt-16 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-amber-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to villager, @Director, Workspace tab, report, or Morning Briefing..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 shrink-0">
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Jump"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800/70">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No matching commands, villagers, or reports for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={item.onSelect}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer ${
                    isSelected ? 'bg-slate-800/90 text-white' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700/80 bg-slate-950">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{item.title}</p>
                      <p className="truncate text-[11px] text-slate-400">{item.subtitle}</p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium text-slate-500 whitespace-nowrap">
                    {item.section}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-4 py-2 text-[11px] text-slate-400">
          <span>Tip: Type @Daniel or @Aria in the task bar for direct assignment</span>
          <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] text-slate-500">
            <span>↑↓ Navigate</span>
            <span>·</span>
            <span>↵ Open</span>
          </div>
        </div>
      </div>
    </div>
  );
};
