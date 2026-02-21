# Bug Fixes — Transcript Parser (Code Review #3)

Derived from code-review-3.txt. Ordered by priority.

---

## P0 — Fix before integration

### [x] BUG-1: Claude 3.x pricing rules use wrong model ID naming convention

**File:** `src/parser/pricing.ts:62-73`

**Bug:** Three pricing rules assume Claude 4+ naming format (`claude-{family}-{ver}`) for Claude 3.x models, which actually use (`claude-{ver}-{family}`). The `"claude-sonnet-"` catch-all also misses old Sonnet 3.5/3.7 IDs.

| Current (wrong)       | Real model ID                    |
| --------------------- | -------------------------------- |
| `"claude-opus-3"`     | `"claude-3-opus-20240229"`       |
| `"claude-haiku-3-5"`  | `"claude-3-5-haiku-20241022"`    |
| `"claude-haiku-3"`    | `"claude-3-haiku-20240307"`      |
| (no match)            | `"claude-3-5-sonnet-20241022"`   |
| (no match)            | `"claude-3-7-sonnet-20250219"`   |

**Impact:** `lookupPricing()` returns `null` → `computeCost()` returns `$0` for any Claude 3.x session.

**Fix:** Add prefix rules for the 3.x naming convention. Insert these *after* the existing Claude 4+ rules:

```ts
// Claude 3.x naming convention (claude-{ver}-{family})
["claude-3-opus",      OPUS_LEGACY],
["claude-3-5-sonnet",  SONNET],
["claude-3-7-sonnet",  SONNET],
["claude-3-5-haiku",   HAIKU_35],
["claude-3-haiku",     HAIKU_3],
```

Update tests to use real model IDs instead of fabricated ones.

---

### [x] BUG-2: Context snapshots omit cache tokens from cumulative input count

**File:** `src/parser/enrich-session.ts:214`

**Bug:** Context snapshots accumulate only `input_tokens + output_tokens`, but the Claude API's `input_tokens` field does **not** include cache tokens. Total input context is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.

**Impact:** For sessions with prompt caching (typical for Claude Code), context is undercounted by 80%+ since most input comes from cache reads.

**Inconsistency:** `TokenTotals` computation (line 139-142) already correctly separates all four token categories, so the same file handles it two different ways.

**Fix:** In the context snapshot loop (line 214), replace:

```ts
cumulativeInput += response.usage.input_tokens;
```

with:

```ts
cumulativeInput += response.usage.input_tokens
  + (response.usage.cache_read_input_tokens ?? 0)
  + (response.usage.cache_creation_input_tokens ?? 0);
```

---

## P1 — Fix soon

### [x] ISSUE-1: Turn duration matching uses iteration order, not parentUuid

**File:** `src/parser/enrich-session.ts:41-43`

**Bug:** `durationMs` is assigned to `turns[currentTurnIndex]`, assuming turn-duration records appear sequentially. The `parentUuid` field (which could match `Turn.promptUuid`) is ignored. If JSONL ordering is ever non-sequential, durations get attributed to the wrong turn.

**Fix:** Replace positional matching with UUID-based matching:

```ts
// Before:
if (msg.kind === "system-turn-duration" && currentTurnIndex >= 0) {
  turns[currentTurnIndex].durationMs = msg.durationMs;
}

// After:
if (msg.kind === "system-turn-duration") {
  const turn = turns.find(t => t.promptUuid === msg.parentUuid);
  if (turn) turn.durationMs = msg.durationMs;
}
```

---

### [x] ISSUE-3: `String(content)` produces `[object Object]` for structured errors

**File:** `src/parser/enrich-session.ts:169`

**Bug:** `errorText` in error samples uses `String(content)`, which produces `"[object Object]"` for structured error content (objects/arrays), destroying diagnostic information.

**Fix:** Replace:

```ts
errorText: String(tc.toolResultBlock.content),
```

with:

```ts
errorText: typeof tc.toolResultBlock.content === "string"
  ? tc.toolResultBlock.content
  : JSON.stringify(tc.toolResultBlock.content),
```

---

### [x] ISSUE-4: `makeAssistantRecord` first argument is dead code when message is overridden

**File:** `src/parser/__tests__/helpers.ts:56-75`

**Bug:** The `contentBlock` first argument builds `message.content: [contentBlock]`, but when callers pass a `message` override, the spread `...overrides` replaces the entire message — silently discarding the first argument. 20+ call sites in `parse-full-session.test.ts` are affected.

**Fix:** Merge `overrides.message` with the default message instead of full replacement:

```ts
export function makeAssistantRecord(
  contentBlock: ContentBlockInput = makeTextBlock(""),
  overrides: Record<string, unknown> = {},
) {
  const { message: messageOverrides, ...rest } = overrides as {
    message?: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...makeCommonFields({ uuid: "uuid-asst-001", parentUuid: "uuid-user-001" }),
    type: "assistant" as const,
    message: {
      model: "claude-sonnet-4-20250514",
      id: "msg-resp-001",
      type: "message" as const,
      role: "assistant" as const,
      content: [contentBlock],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
      ...messageOverrides,
    },
    ...rest,
  };
}
```

Then audit call sites — any that manually duplicate the content block inside `message` can be simplified.

---

## P2 — Address when convenient

### [ ] LIKELY-BUG-1: Pre-turn messages get phantom `turnIndex: 0`

**File:** `src/parser/enrich-session.ts:45`

**Bug:** `Math.max(currentTurnIndex, 0)` maps messages arriving before any turn to `turnIndex: 0`. Downstream consumers doing `turns[response.turnIndex]` will get `undefined` since turn 0 doesn't exist yet.

**Fix:** Change to `number | null`:

1. In `enrich-session.ts:45`, replace:
   ```ts
   lineToTurn.set(msg.lineIndex, Math.max(currentTurnIndex, 0));
   ```
   with:
   ```ts
   lineToTurn.set(msg.lineIndex, currentTurnIndex >= 0 ? currentTurnIndex : null);
   ```

2. Update `lineToTurn` type to `Map<number, number | null>`.

3. Update `turnIndex` type in `ReconstitutedResponse`, `PairedToolCall`, `ContextSnapshot`, and `ToolStat.errorSamples` from `number` to `number | null` in `types.ts`.

4. Guard all `turns[response.turnIndex]` accesses with a null check.

---

### [ ] ISSUE-2: Unbounded `errorSamples` array in ToolStat

**File:** `src/parser/enrich-session.ts:167`

**Bug:** `errorSamples` grows without limit. A tool that errors in a retry loop could accumulate thousands of entries.

**Fix:** Cap at 10 samples per tool:

```ts
if (tc.toolResultBlock?.isError) {
  stat.errorCount++;
  if (stat.errorSamples.length < 10) {
    stat.errorSamples.push({ ... });
  }
}
```

---

### [ ] ISSUE-9: `Turn.isMeta` is always `false` (dead field)

**File:** `src/parser/types.ts:52`, `src/parser/enrich-session.ts:37`

**Bug:** Meta prompts are excluded from turn creation by the `!msg.isMeta` guard (line 28). All created turns hardcode `isMeta: false`. The field carries no information.

**Fix:** Remove `isMeta` from the `Turn` interface and from the turn construction in `enrichSession`.
