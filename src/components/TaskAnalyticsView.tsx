import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FileText, RotateCcw } from 'lucide-react';
import {
  SOURCE_LABELS,
  buildCompletionTrendSeries,
  buildDepartmentFulfillmentSeries,
  buildEnrichedTaskMetrics,
  buildSourceDistributionSeries,
  type TrendWindow,
} from '../lib/taskAnalytics';
import type { ApprovalItem, TaskSource, VillageTask } from '../types/village';

interface TaskAnalyticsViewProps {
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  onOpenTaskReport: (task: VillageTask) => void;
  onPrefillTask: (prompt: string) => void;
}

export const TaskAnalyticsView: React.FC<TaskAnalyticsViewProps> = ({
  tasks,
  approvals,
  onOpenTaskReport,
  onPrefillTask,
}) => {
  const allMetrics = useMemo(
    () => buildEnrichedTaskMetrics(tasks, approvals),
    [tasks, approvals]
  );

  // Default to 24h view if all tasks happened within the last 24 hours so intraday momentum is clearly visible, otherwise 7d
  const defaultWindow = useMemo<TrendWindow>(() => {
    if (allMetrics.length === 0) return '7d';
    const oldest = Math.min(...allMetrics.map((m) => m.timestampMs));
    return Date.now() - oldest <= 24 * 60 * 60 * 1000 ? '24h' : '7d';
  }, [allMetrics]);

  const [trendWindow, setTrendWindow] = useState<TrendWindow>(defaultWindow);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<TaskSource | 'all'>('all');

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMetrics) set.add(m.department);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allMetrics]);

  const scopedMetrics = useMemo(() => {
    return allMetrics.filter((m) => {
      if (selectedDepartment !== 'all' && m.department !== selectedDepartment) {
        return false;
      }
      if (selectedSource !== 'all' && m.source !== selectedSource) {
        return false;
      }
      return true;
    });
  }, [allMetrics, selectedDepartment, selectedSource]);

  const trendData = useMemo(
    () => buildCompletionTrendSeries(scopedMetrics, trendWindow),
    [scopedMetrics, trendWindow]
  );

  // Department fulfillment compares all departments (or filtered by source) so clicking bars toggles department focus cleanly
  const departmentBaseMetrics = useMemo(
    () =>
      selectedSource === 'all'
        ? allMetrics
        : allMetrics.filter((m) => m.source === selectedSource),
    [allMetrics, selectedSource]
  );

  const departmentData = useMemo(
    () => buildDepartmentFulfillmentSeries(departmentBaseMetrics),
    [departmentBaseMetrics]
  );

  // Source distribution reflects current department filter
  const sourceBaseMetrics = useMemo(
    () =>
      selectedDepartment === 'all'
        ? allMetrics
        : allMetrics.filter((m) => m.department === selectedDepartment),
    [allMetrics, selectedDepartment]
  );

  const sourceData = useMemo(
    () => buildSourceDistributionSeries(sourceBaseMetrics),
    [sourceBaseMetrics]
  );

  const pieSlices = useMemo(
    () => sourceData.filter((s) => s.count > 0),
    [sourceData]
  );

  const kpiSummary = useMemo(() => {
    const total = scopedMetrics.length;
    const completed = scopedMetrics.filter((m) => m.isCompleted).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgSec =
      total > 0
        ? Number(
            (
              scopedMetrics.reduce((acc, m) => acc + m.fulfillmentSeconds, 0) / total
            ).toFixed(1)
          )
        : 0;
    const topSource = [...sourceData].sort((a, b) => b.count - a.count)[0];
    return {
      total,
      completed,
      rate,
      avgSec,
      topSourceLabel: topSource && topSource.count > 0 ? topSource.label : 'None',
      topSourceCount: topSource?.count ?? 0,
    };
  }, [scopedMetrics, sourceData]);

  const hasFilters = selectedDepartment !== 'all' || selectedSource !== 'all';

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="space-y-1.5 max-w-sm">
          <h3 className="text-sm font-semibold text-white">No task telemetry recorded yet</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Once you dispatch tasks via Matt, Gmail, or Calendar, this view charts completion trends, average fulfillment speed by guild department, and task source distribution.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() =>
              onPrefillTask(
                'Check my unread Gmail threads and draft any priority follow-up replies'
              )
            }
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
          >
            Try Gmail task
          </button>
          <button
            type="button"
            onClick={() =>
              onPrefillTask(
                'Design an idempotent webhook & retry integration pipeline between Stripe and Postgres'
              )
            }
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
          >
            Try manual engineering task
          </button>
        </div>
      </div>
    );
  }

  const departmentChartHeight = Math.max(148, departmentData.length * 38 + 28);

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-slate-800/90">
      {/* Filter Controls & KPI Summary Strip */}
      <section className="p-4 space-y-3 bg-slate-950/40">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              aria-label="Filter analytics by department"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none cursor-pointer"
            >
              <option value="all">All Departments ({departmentOptions.length})</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
              {(
                [
                  ['all', 'All Sources'],
                  ['manual', 'Manual'],
                  ['gmail', 'Gmail'],
                  ['calendar', 'Calendar'],
                  ['chat', 'Chat'],
                  ['docs', 'Docs'],
                  ['drive', 'Drive'],
                ] as Array<[TaskSource | 'all', string]>
              ).map(([srcKey, label]) => (
                <button
                  key={srcKey}
                  type="button"
                  onClick={() => setSelectedSource(srcKey)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedSource === srcKey
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSelectedDepartment('all');
                setSelectedSource('all');
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Unboxed Tabular KPI Row */}
        <div className="grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-800/80 pt-3">
          <div className="pr-3">
            <p className="text-[11px] text-slate-400">Completed Tasks</p>
            <p className="mt-0.5 font-mono text-base font-semibold text-white tabular-nums">
              {kpiSummary.completed}
              <span className="text-xs font-normal text-slate-400">
                {' '}
                / {kpiSummary.total} ({kpiSummary.rate}%)
              </span>
            </p>
          </div>
          <div className="px-3">
            <p className="text-[11px] text-slate-400">Avg Fulfillment Time</p>
            <p className="mt-0.5 font-mono text-base font-semibold text-amber-400 tabular-nums">
              {kpiSummary.avgSec.toFixed(1)}s
            </p>
          </div>
          <div className="pl-3">
            <p className="text-[11px] text-slate-400">Top Task Source</p>
            <p className="mt-0.5 text-sm font-semibold text-white truncate tabular-nums">
              {kpiSummary.topSourceLabel}{' '}
              <span className="font-mono text-xs font-normal text-slate-400">
                ({kpiSummary.topSourceCount})
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* 01. Task Completion Trends (Recharts AreaChart) */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-white">01. Task Completion Trends</h3>
            <p className="text-[11px] text-slate-400">
              Completed deliverables vs. items awaiting approval over time
            </p>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5 shrink-0">
            {(
              [
                ['24h', '24h'],
                ['7d', '7d'],
                ['14d', '14d'],
              ] as Array<[TrendWindow, string]>
            ).map(([win, label]) => (
              <button
                key={win}
                type="button"
                onClick={() => setTrendWindow(win)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  trendWindow === win
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-48 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={trendData}
              margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
            >
              <defs>
                <linearGradient id="completedTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="pendingTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  borderColor: '#334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
                labelStyle={{ color: '#cbd5e1', fontWeight: 600, marginBottom: 4 }}
              />
              <Area
                type="monotone"
                dataKey="completed"
                name="Completed"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#completedTrendFill)"
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="pendingApproval"
                name="Awaiting Approval"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#pendingTrendFill)"
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 bg-emerald-500 inline-block" aria-hidden="true" />
            <span>Completed</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 bg-amber-500 inline-block" aria-hidden="true" />
            <span>Awaiting CHO Approval</span>
          </span>
        </div>
      </section>

      {/* 02. Average Fulfillment Time by Department (Recharts Horizontal BarChart) */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-white">
              02. Average Fulfillment Time by Department
            </h3>
            <p className="text-[11px] text-slate-400">
              End-to-end specialist draft & director review speed in seconds (click a bar to filter)
            </p>
          </div>
          {selectedDepartment !== 'all' && (
            <span className="text-[11px] text-amber-400 whitespace-nowrap shrink-0">
              Filtered: {selectedDepartment}
            </span>
          )}
        </div>

        {departmentData.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            No department data for the selected task source filter.
          </p>
        ) : (
          <div style={{ height: departmentChartHeight }} className="w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={departmentData}
                layout="vertical"
                margin={{ top: 4, right: 18, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  unit="s"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#334155' }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="shortDepartment"
                  width={92}
                  tick={{ fill: '#e2e8f0', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(30, 41, 59, 0.45)' }}
                  contentStyle={{
                    backgroundColor: '#020617',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                  formatter={(value, _name, props) => {
                    const sec = typeof value === 'number' ? value.toFixed(1) : String(value ?? '');
                    const count = (props?.payload as { taskCount?: number } | undefined)?.taskCount ?? 0;
                    return [`${sec}s avg (${count} ${count === 1 ? 'task' : 'tasks'})`, 'Fulfillment'];
                  }}
                  labelFormatter={(_label, payload) => {
                    const first = payload?.[0]?.payload as { department?: string } | undefined;
                    return first?.department ?? '';
                  }}
                />
                <Bar
                  dataKey="avgSeconds"
                  radius={[0, 4, 4, 0]}
                  barSize={18}
                  className="cursor-pointer"
                  onClick={(entry) => {
                    const dept = (entry as { department?: string } | undefined)?.department;
                    if (!dept) return;
                    setSelectedDepartment((prev) => (prev === dept ? 'all' : dept));
                  }}
                >
                  {departmentData.map((entry) => {
                    const isActive =
                      selectedDepartment === 'all' || selectedDepartment === entry.department;
                    return (
                      <Cell
                        key={entry.department}
                        fill={
                          selectedDepartment === entry.department
                            ? '#f59e0b'
                            : isActive
                              ? '#38bdf8'
                              : '#334155'
                        }
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 03. Distribution of Task Sources: Gmail, Calendar, or Manual (Recharts Donut + Tabular Breakdown) */}
      <section className="p-4 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-white">
            03. Distribution of Task Sources
          </h3>
          <p className="text-[11px] text-slate-400">
            Share of dispatches originating from Gmail, Calendar, Chat, Docs, Drive, or Manual input
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-4">
          <div className="sm:col-span-5 h-44 w-full min-w-0">
            {pieSlices.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No tasks in filter
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieSlices}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={66}
                    paddingAngle={pieSlices.length > 1 ? 3 : 0}
                    stroke="#0f172a"
                    strokeWidth={2}
                    onClick={(entry) => {
                      const src = (entry as { source?: TaskSource } | undefined)?.source;
                      if (!src) return;
                      setSelectedSource((prev) => (prev === src ? 'all' : src));
                    }}
                    className="cursor-pointer"
                  >
                    {pieSlices.map((slice) => (
                      <Cell
                        key={slice.source}
                        fill={slice.color}
                        opacity={
                          selectedSource === 'all' || selectedSource === slice.source ? 1 : 0.35
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                    formatter={(value, name, props) => {
                      const pct =
                        (props?.payload as { percentage?: number } | undefined)?.percentage ?? 0;
                      return [`${String(value ?? 0)} tasks (${pct}%)`, String(name ?? '')];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="sm:col-span-7">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-1.5 font-medium">Source</th>
                  <th className="py-1.5 text-right font-medium">Tasks</th>
                  <th className="py-1.5 text-right font-medium">Share</th>
                  <th className="py-1.5 text-right font-medium">Avg Speed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {sourceData.map((row) => {
                  const isFocused = selectedSource === row.source;
                  return (
                    <tr
                      key={row.source}
                      onClick={() =>
                        setSelectedSource((prev) => (prev === row.source ? 'all' : row.source))
                      }
                      className={`transition-colors cursor-pointer ${
                        isFocused ? 'bg-slate-800/70 text-white' : 'hover:bg-slate-950/60 text-slate-200'
                      }`}
                    >
                      <td className="py-2 pr-2 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 inline-block"
                            style={{ backgroundColor: row.color }}
                            aria-hidden="true"
                          />
                          <span>{row.label}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums">
                        {row.count}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400 tabular-nums">
                        {row.percentage}%
                      </td>
                      <td className="py-2 pl-2 text-right font-mono text-slate-300 tabular-nums">
                        {row.count > 0 ? `${row.avgSeconds.toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Scoped Task Drill-Down List */}
      <section className="p-4 space-y-2.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
          <span className="font-semibold text-slate-300">
            Matching Deliverables ({scopedMetrics.length})
          </span>
          <span>Click any row to inspect report</span>
        </div>

        {scopedMetrics.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            No tasks match the active department and source filters.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/70 border-t border-slate-800/70">
            {scopedMetrics.slice(0, 8).map((item) => (
              <button
                key={item.task.id}
                type="button"
                onClick={() => onOpenTaskReport(item.task)}
                className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-950/50 transition-colors cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">{item.task.prompt}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400 truncate tabular-nums">
                    {item.department} · {SOURCE_LABELS[item.source]} ·{' '}
                    {item.isCompleted ? 'Completed' : 'Awaiting Approval'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 font-mono text-xs text-amber-300 tabular-nums">
                  <span>{item.fulfillmentSeconds.toFixed(1)}s</span>
                  <FileText className="h-3.5 w-3.5 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
