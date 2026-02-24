import type { EnrichedSession } from "@/types/api";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface AnalyticsPanelProps {
  session: EnrichedSession;
}

/** Format a token count with locale separators. */
function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format a USD cost value. */
function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

/** Format a percentage with one decimal place. */
function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Known context window limits (in tokens) for common model families. Returns null if unknown. */
function getContextWindowLimit(model: string | undefined): number | null {
  if (!model) return null;
  const m = model.toLowerCase();
  // All Claude 3+ models: 200K tokens
  if (m.includes("claude")) return 200_000;
  // GPT-4 Turbo / GPT-4o: 128K
  if (m.includes("gpt-4")) return 128_000;
  return null;
}

export function AnalyticsPanel({ session }: AnalyticsPanelProps) {
  const { totals, toolStats, turns, contextSnapshots, responses } = session;
  const sessionModel = responses[0]?.model;
  const contextLimit = getContextWindowLimit(sessionModel);

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l bg-muted/30">
      <Tabs defaultValue="tokens" className="flex h-full flex-col">
        <TabsList variant="line" className="w-full shrink-0 border-b px-2 pt-2">
          <TabsTrigger value="tokens" className="text-xs">
            Tokens
          </TabsTrigger>
          <TabsTrigger value="cost" className="text-xs">
            Cost
          </TabsTrigger>
          <TabsTrigger value="context" className="text-xs">
            Context
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-xs">
            Tools
          </TabsTrigger>
          <TabsTrigger value="turns" className="text-xs">
            Turns
          </TabsTrigger>
        </TabsList>

        {/* Token Usage */}
        <TabsContent value="tokens" className="overflow-y-auto p-4">
          <TokenUsageTab totals={totals} responses={responses} />
        </TabsContent>

        {/* Cost */}
        <TabsContent value="cost" className="overflow-y-auto p-4">
          <CostTab totals={totals} responses={responses} />
        </TabsContent>

        {/* Context Window */}
        <TabsContent value="context" className="overflow-y-auto p-4">
          <ContextTab snapshots={contextSnapshots} contextLimit={contextLimit} />
        </TabsContent>

        {/* Tool Statistics */}
        <TabsContent value="tools" className="overflow-y-auto p-4">
          <ToolsTab toolStats={toolStats} totalToolUseCount={totals.toolUseCount} />
        </TabsContent>

        {/* Turn Timeline */}
        <TabsContent value="turns" className="overflow-y-auto p-4">
          <TurnsTab turns={turns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panel: Token Usage
// ---------------------------------------------------------------------------

function TokenUsageTab({
  totals,
  responses,
}: {
  totals: EnrichedSession["totals"];
  responses: EnrichedSession["responses"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Token Usage</h3>

      {/* Summary totals */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Input" value={formatTokens(totals.inputTokens)} />
        <Stat label="Output" value={formatTokens(totals.outputTokens)} />
        <Stat
          label="Cache Read"
          value={formatTokens(totals.cacheReadInputTokens)}
        />
        <Stat
          label="Cache Create"
          value={formatTokens(totals.cacheCreationInputTokens)}
        />
        <Stat
          label="Total"
          value={formatTokens(totals.totalTokens)}
          highlight
        />
      </div>

      {/* Per-response breakdown */}
      {responses.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Per Response
          </h4>
          <div className="flex flex-col gap-1.5">
            {responses.map((r, i) => {
              const input = r.usage.input_tokens;
              const output = r.usage.output_tokens;
              const cacheRead = r.usage.cache_read_input_tokens ?? 0;
              const cacheCreate = r.usage.cache_creation_input_tokens ?? 0;
              const total = input + output + cacheRead + cacheCreate;
              return (
                <TokenBar
                  key={r.messageId}
                  index={i}
                  input={input}
                  output={output}
                  cacheRead={cacheRead}
                  cacheCreate={cacheCreate}
                  total={total}
                  maxTotal={Math.max(
                    ...responses.map(
                      (resp) =>
                        resp.usage.input_tokens +
                        resp.usage.output_tokens +
                        (resp.usage.cache_read_input_tokens ?? 0) +
                        (resp.usage.cache_creation_input_tokens ?? 0),
                    ),
                  )}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Stacked horizontal bar for one response's token breakdown. */
function TokenBar({
  index,
  input,
  output,
  cacheRead,
  cacheCreate,
  total,
  maxTotal,
}: {
  index: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  total: number;
  maxTotal: number;
}) {
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const segments = [
    { value: input, color: "bg-blue-500", label: "input" },
    { value: output, color: "bg-emerald-500", label: "output" },
    { value: cacheRead, color: "bg-amber-400", label: "cache read" },
    { value: cacheCreate, color: "bg-purple-400", label: "cache create" },
  ];

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>R{index + 1}</span>
        <span>{formatTokens(total)}</span>
      </div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-muted"
        style={{ width: `${Math.max(pct, 4)}%` }}
        title={segments
          .filter((s) => s.value > 0)
          .map((s) => `${s.label}: ${formatTokens(s.value)}`)
          .join(", ")}
      >
        {segments.map(
          (seg) =>
            seg.value > 0 && (
              <div
                key={seg.label}
                className={`${seg.color} h-full`}
                style={{
                  width: `${total > 0 ? (seg.value / total) * 100 : 0}%`,
                }}
              />
            ),
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panel: Cost
// ---------------------------------------------------------------------------

function CostTab({
  totals,
  responses,
}: {
  totals: EnrichedSession["totals"];
  responses: EnrichedSession["responses"];
}) {
  // Build cumulative cost series (rough estimate: distribute total cost proportionally by tokens)
  const totalTokensAll = responses.reduce(
    (sum, r) =>
      sum +
      r.usage.input_tokens +
      r.usage.output_tokens +
      (r.usage.cache_read_input_tokens ?? 0) +
      (r.usage.cache_creation_input_tokens ?? 0),
    0,
  );

  const points = responses.reduce<Array<{ index: number; cumulative: number }>>(
    (acc, r, i) => {
      const rTokens =
        r.usage.input_tokens +
        r.usage.output_tokens +
        (r.usage.cache_read_input_tokens ?? 0) +
        (r.usage.cache_creation_input_tokens ?? 0);
      const portion =
        totalTokensAll > 0
          ? (rTokens / totalTokensAll) * totals.estimatedCostUsd
          : 0;
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
      acc.push({ index: i + 1, cumulative: prev + portion });
      return acc;
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Cost</h3>
      <div className="text-2xl font-bold">
        {formatCost(totals.estimatedCostUsd)}
      </div>

      {/* Cumulative cost chart (simple SVG) */}
      {points.length > 1 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Cumulative Over Responses
          </h4>
          <CumulativeCostChart
            points={points}
            maxCost={totals.estimatedCostUsd}
          />
        </div>
      )}
    </div>
  );
}

/** Simple SVG line chart for cumulative cost. */
function CumulativeCostChart({
  points,
  maxCost,
}: {
  points: Array<{ index: number; cumulative: number }>;
  maxCost: number;
}) {
  const width = 280;
  const height = 120;
  const padX = 32;
  const padY = 16;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const maxIdx = points[points.length - 1].index;
  const toX = (idx: number) => padX + (idx / maxIdx) * plotW;
  const toY = (cost: number) =>
    padY + plotH - (maxCost > 0 ? (cost / maxCost) * plotH : 0);

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.index)} ${toY(p.cumulative)}`)
    .join(" ");

  const areaD =
    pathD +
    ` L ${toX(maxIdx)} ${padY + plotH} L ${toX(points[0].index)} ${padY + plotH} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      aria-label="Cumulative cost over responses"
    >
      {/* Grid lines */}
      <line
        x1={padX}
        y1={padY + plotH}
        x2={padX + plotW}
        y2={padY + plotH}
        stroke="currentColor"
        strokeOpacity={0.15}
      />
      <line
        x1={padX}
        y1={padY}
        x2={padX + plotW}
        y2={padY}
        stroke="currentColor"
        strokeOpacity={0.1}
        strokeDasharray="4 4"
      />

      {/* Area fill */}
      <path d={areaD} fill="currentColor" fillOpacity={0.06} />

      {/* Line */}
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={0.6} />

      {/* Axis labels */}
      <text x={padX} y={height - 2} fontSize={9} fill="currentColor" fillOpacity={0.5}>
        1
      </text>
      <text
        x={padX + plotW}
        y={height - 2}
        fontSize={9}
        fill="currentColor"
        fillOpacity={0.5}
        textAnchor="end"
      >
        {maxIdx}
      </text>
      <text x={padX - 4} y={padY + 4} fontSize={9} fill="currentColor" fillOpacity={0.5} textAnchor="end">
        {formatCost(maxCost)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-panel: Context Window
// ---------------------------------------------------------------------------

function ContextTab({
  snapshots,
  contextLimit,
}: {
  snapshots: EnrichedSession["contextSnapshots"];
  contextLimit: number | null;
}) {
  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Context Window</h3>
        <p className="text-sm text-muted-foreground">
          No context snapshots available.
        </p>
      </div>
    );
  }

  const dataMax = Math.max(
    ...snapshots.map((s) => s.cumulativeInputTokens + s.cumulativeOutputTokens),
  );
  // Scale chart to whichever is larger: actual data or context limit
  const maxTokens = Math.max(dataMax, contextLimit ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Context Window</h3>
      <ContextChart snapshots={snapshots} maxTokens={maxTokens} contextLimit={contextLimit} />
    </div>
  );
}

/** Simple SVG area chart for context window utilization. */
function ContextChart({
  snapshots,
  maxTokens,
  contextLimit,
}: {
  snapshots: EnrichedSession["contextSnapshots"];
  maxTokens: number;
  contextLimit: number | null;
}) {
  const width = 280;
  const height = 140;
  const padX = 36;
  const padY = 16;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const n = snapshots.length;
  const toX = (i: number) => padX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const toY = (tokens: number) =>
    padY + plotH - (maxTokens > 0 ? (tokens / maxTokens) * plotH : 0);

  // Cumulative output (stacked on top of input)
  const totalPath = snapshots
    .map((s, i) => {
      const y = toY(s.cumulativeInputTokens + s.cumulativeOutputTokens);
      return `${i === 0 ? "M" : "L"} ${toX(i)} ${y}`;
    })
    .join(" ");

  const totalArea =
    totalPath +
    ` L ${toX(n - 1)} ${padY + plotH} L ${toX(0)} ${padY + plotH} Z`;

  // Input only
  const inputPath = snapshots
    .map((s, i) => {
      const y = toY(s.cumulativeInputTokens);
      return `${i === 0 ? "M" : "L"} ${toX(i)} ${y}`;
    })
    .join(" ");

  const inputArea =
    inputPath +
    ` L ${toX(n - 1)} ${padY + plotH} L ${toX(0)} ${padY + plotH} Z`;

  // Context limit reference line position (only if known and fits in chart)
  const limitY = contextLimit != null ? toY(contextLimit) : null;
  const limitLabel = contextLimit != null ? `${(contextLimit / 1000).toFixed(0)}K limit` : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      aria-label="Context window utilization"
    >
      {/* Grid */}
      <line
        x1={padX}
        y1={padY + plotH}
        x2={padX + plotW}
        y2={padY + plotH}
        stroke="currentColor"
        strokeOpacity={0.15}
      />

      {/* Context window limit reference line */}
      {limitY != null && (
        <>
          <line
            x1={padX}
            y1={limitY}
            x2={padX + plotW}
            y2={limitY}
            stroke="rgb(239 68 68)"
            strokeWidth={1}
            strokeOpacity={0.5}
            strokeDasharray="4 3"
          />
          <text
            x={padX + plotW}
            y={limitY - 3}
            fontSize={8}
            fill="rgb(239 68 68)"
            fillOpacity={0.7}
            textAnchor="end"
          >
            {limitLabel}
          </text>
        </>
      )}

      {/* Total (input + output) area */}
      <path d={totalArea} fill="rgb(16 185 129)" fillOpacity={0.12} />
      <path d={totalPath} fill="none" stroke="rgb(16 185 129)" strokeWidth={1.5} strokeOpacity={0.5} />

      {/* Input-only area */}
      <path d={inputArea} fill="rgb(59 130 246)" fillOpacity={0.15} />
      <path d={inputPath} fill="none" stroke="rgb(59 130 246)" strokeWidth={1.5} strokeOpacity={0.6} />

      {/* Axis labels */}
      <text x={padX - 4} y={padY + 4} fontSize={9} fill="currentColor" fillOpacity={0.5} textAnchor="end">
        {formatTokens(maxTokens)}
      </text>
      <text x={padX - 4} y={padY + plotH + 4} fontSize={9} fill="currentColor" fillOpacity={0.5} textAnchor="end">
        0
      </text>

      {/* Legend */}
      <rect x={padX} y={height - 10} width={8} height={8} rx={1} fill="rgb(59 130 246)" fillOpacity={0.6} />
      <text x={padX + 12} y={height - 3} fontSize={8} fill="currentColor" fillOpacity={0.5}>
        Input
      </text>
      <rect x={padX + 50} y={height - 10} width={8} height={8} rx={1} fill="rgb(16 185 129)" fillOpacity={0.5} />
      <text x={padX + 62} y={height - 3} fontSize={8} fill="currentColor" fillOpacity={0.5}>
        Output
      </text>
      {contextLimit != null && (
        <>
          <line x1={padX + 115} y1={height - 6} x2={padX + 123} y2={height - 6} stroke="rgb(239 68 68)" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="3 2" />
          <text x={padX + 127} y={height - 3} fontSize={8} fill="rgb(239 68 68)" fillOpacity={0.7}>
            Limit
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-panel: Tool Statistics
// ---------------------------------------------------------------------------

function ToolsTab({
  toolStats,
  totalToolUseCount,
}: {
  toolStats: EnrichedSession["toolStats"];
  totalToolUseCount: number;
}) {
  if (toolStats.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Tool Statistics</h3>
        <p className="text-sm text-muted-foreground">No tool calls recorded.</p>
      </div>
    );
  }

  const sorted = [...toolStats].sort((a, b) => b.callCount - a.callCount);

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Tool Statistics</h3>
      <div className="text-xs text-muted-foreground">
        {totalToolUseCount} total call{totalToolUseCount !== 1 ? "s" : ""}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-2 font-medium">Tool</th>
              <th className="pb-2 px-2 font-medium text-right">Calls</th>
              <th className="pb-2 px-2 font-medium text-right">Errors</th>
              <th className="pb-2 pl-2 font-medium text-right">Error Rate</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tool) => (
              <tr key={tool.toolName} className="border-b border-border/50">
                <td className="py-1.5 pr-2 truncate max-w-[120px]" title={tool.toolName}>
                  {tool.toolName}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {tool.callCount}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {tool.errorCount > 0 ? (
                    <span className="text-destructive">{tool.errorCount}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {tool.callCount > 0 ? (
                    <span
                      className={
                        tool.errorCount / tool.callCount > 0.1
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {formatPct(tool.errorCount / tool.callCount)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panel: Turn Timeline
// ---------------------------------------------------------------------------

function TurnsTab({ turns }: { turns: EnrichedSession["turns"] }) {
  if (turns.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">Turn Timeline</h3>
        <p className="text-sm text-muted-foreground">No turns recorded.</p>
      </div>
    );
  }

  const maxDuration = Math.max(
    ...turns.map((t) => t.durationMs ?? 0).filter((d) => d > 0),
    1,
  );

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Turn Timeline</h3>
      <div className="flex flex-col gap-1.5">
        {turns.map((turn) => {
          const durationMs = turn.durationMs ?? 0;
          const durationSec = durationMs / 1000;
          const pct = maxDuration > 0 ? (durationMs / maxDuration) * 100 : 0;
          const promptPreview =
            turn.promptText.length > 40
              ? turn.promptText.slice(0, 40) + "…"
              : turn.promptText;

          return (
            <div key={turn.turnIndex} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[180px]" title={turn.promptText}>
                  T{turn.turnIndex}: {promptPreview}
                </span>
                <span className="shrink-0 tabular-nums">
                  {durationMs > 0 ? `${durationSec.toFixed(1)}s` : "—"}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground/20"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={highlight ? "text-lg font-bold" : "text-sm font-semibold"}>
        {value}
      </p>
    </div>
  );
}
