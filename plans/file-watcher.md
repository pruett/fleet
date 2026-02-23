# Implementation Plan: File Watcher

> Source: `specs/file-watcher.md`
> Generated: 2026-02-22

---

## Phase 0 — Tracer Bullet
> Minimal end-to-end: fs.watch fires → Bun.file().slice().text() reads new bytes → parseLine → deliver batch to callback

### Types & Skeleton
- [x] Create `src/watcher/types.ts` with `WatchOptions`, `WatchHandle`, `WatchBatch`, `WatchError` types (mirror spec definitions exactly)
- [x] Import `ParsedMessage` from `src/parser` for the `WatchBatch.messages` field
- [x] Create `src/watcher/index.ts` barrel exporting `watchSession`, `stopWatching`, `stopAll`, and all types

### Core Read Loop
- [x] Create `src/watcher/watch-session.ts` exporting `watchSession(options: WatchOptions): WatchHandle`
- [x] On init: get initial size via `Bun.file(filePath).size`, set `byteOffset = size`, register `fs.watch` listener, return `WatchHandle`
- [x] On fs.watch change event: check `Bun.file(filePath).size`, if `currentSize > byteOffset` read new bytes via `Bun.file(filePath).slice(byteOffset, currentSize).text()`
- [x] Split on `\n`, pass complete lines to `parseLine()` from `src/parser`, collect non-null results
- [x] Flush immediately (no debounce yet) — call `onMessages` with a `WatchBatch` containing collected messages and `byteRange`

### Tracer Bullet Test
- [x] Create `src/watcher/__tests__/helpers.ts` with temp file utilities (create temp `.jsonl`, append lines, cleanup)
- [x] Create `src/watcher/__tests__/watch-session.test.ts` — write JSONL lines to a temp file, call `watchSession` with `debounceMs: 0` / `maxWaitMs: 0`, assert callback receives correct `ParsedMessage[]` with correct `byteRange`

---

## Phase 1 — Core Logic

### Partial Line Buffering
- [x] Add `lineBuffer: string` to internal watcher state, persisting across reads
- [x] Prepend `lineBuffer` to text from `.text()` before splitting; pop last segment as new `lineBuffer`
- [x] Test: write a line in two halves (first without `\n`, second with `\n`) — assert one message produced only after second write
- [x] Test: verify `lineBuffer` is empty string (not partial content) after a complete-line write

### Two-Phase Debounce
- [x] Implement `scheduleBatchFlush()` with trailing-edge timer (`debounceMs`) that resets on each new write
- [x] Implement max-wait ceiling timer (`maxWaitMs`) that fires once and does not reset
- [x] On flush: clear both timers, deliver `WatchBatch` with correct `byteRange` (`batchStartOffset` to current `byteOffset`), reset `pendingMessages` and `batchStartOffset`
- [x] Test: write 10 lines in tight loop with default debounce — assert 1–2 batches totaling 10 messages
- [x] Test: write 1 line every 50ms for 2s with `maxWaitMs: 500` — assert at least 4 flushes

### Watcher Registry & Duplicate Prevention
- [x] Add module-level `Map<string, WatchHandle>` registry keyed by `sessionId`
- [x] In `watchSession`: if `sessionId` already in registry, return existing handle without creating a duplicate watcher
- [x] Test: call `watchSession` twice with same `sessionId` — assert same handle returned, single set of events per write

### Stop & Teardown
- [x] Implement `stopWatching(handle)`: close fs.watch listener, cancel timers, final flush if `pendingMessages` non-empty, set `handle.stopped = true`, remove from registry
- [x] Implement `stopAll()`: iterate registry, call `stopWatching` on each, clear registry
- [x] `stopWatching` on an already-stopped handle is a no-op
- [x] Test: append line then immediately `stopWatching` before debounce fires — assert `onMessages` called exactly once with pending message
- [x] Test: verify no callbacks fire after `stopWatching` even when file is appended to
- [x] Test: start 3 watchers, call `stopAll` — all handles have `stopped: true`, no further callbacks

---

## Phase 2 — Edge Cases & Error Handling

### File Truncation Recovery
- [x] If `currentSize < byteOffset`: reset `byteOffset = 0`, clear `lineBuffer`, reset `lineIndex = 0`, re-read from beginning
- [x] Test: start watcher at offset 500, truncate file to 0, write new content — assert watcher delivers new content with reset `lineIndex`

### Error Resilience
- [ ] Wrap `Bun.file().slice().text()` in try/catch — on failure emit `WatchError` with `code: "READ_ERROR"`, continue watching
- [ ] Wrap `parseLine` call in try/catch — on unexpected throw emit `WatchError` with `code: "PARSE_ERROR"`, skip line, continue
- [ ] Handle `fs.watch` error/close event — emit `WatchError` with `code: "WATCH_ERROR"`, auto-stop watcher
- [ ] Test: simulate read error — assert `WatchError` emitted with correct code, watcher continues on next event
- [ ] Test: `fs.watch` error — assert watcher auto-stops and `handle.stopped = true`

### Blank & Malformed Lines
- [ ] Verify blank lines (`\n\n`) are skipped: `lineIndex` does not advance, no batch flushed
- [ ] Verify malformed JSON produces `MalformedRecord` in batch with correct `lineIndex`
- [ ] Test: append `"\n\n"` — assert no batch flushed, `byteOffset` still advances
- [ ] Test: append invalid JSON — assert batch contains `MalformedRecord`, `lineIndex` increments, watcher continues

---

## Phase 3 — Integration & Verification

### End-to-End Consistency
- [ ] Write integration test using real fixture data (reuse `src/parser/__tests__/fixtures/minimal-session.jsonl`)
- [ ] Append fixture lines one-by-one to temp file with watcher at offset 0 and `debounceMs: 0` — verify all batched messages match `parseLine` output exactly (order, `lineIndex`, content)

### 100-Write Stress Test
- [ ] Append 100 valid JSONL lines in sequence — assert total messages across all batches equals exactly 100 (no duplicates, no drops)
