# Bun Monorepo Restructuring Plan

## Context

Fleet has a flat `src/parser/` directory on main. A `src/scanner/` is in a worktree (`feat-project-scanner`). The ARCHITECTURE.md defines 7 components. We're restructuring into a Bun workspace monorepo with 3 packages: `@fleet/types`, `@fleet/server`, `@fleet/client`. The server groups all server-side components internally. The types package provides the shared contract.

## Package Structure

```
fleet/
  package.json                 (workspace root, private: true)
  tsconfig.json                (base config with project references)
  packages/
    types/
      package.json             (@fleet/types)
      tsconfig.json
      src/
        index.ts               (barrel export)
        schemas.ts             (Zod schemas — moved from parser)
        messages.ts            (Zod-inferred message types)
        enrichments.ts         (Turn, EnrichedSession, etc.)
        pricing.ts             (ModelPricing interface only)
        scanner.ts             (ProjectSummary, SessionSummary)
    server/
      package.json             (@fleet/server)
      tsconfig.json
      src/
        index.ts               (barrel export)
        parser/
          index.ts             (parser barrel: parseLine, enrichSession, parseFullSession)
          parse-line.ts
          enrich-session.ts
          parse-full-session.ts
          pricing.ts           (lookupPricing, computeCost — implementation)
          __tests__/
        scanner/
          index.ts             (scanner barrel: scanProjects, scanSessions)
          scan-projects.ts
          scan-sessions.ts
          extract-session-summary.ts
          __tests__/
        watcher/               (future)
        api/                   (future)
        transport/             (future)
        controller/            (future)
    client/                    (future — created when UI work begins)
      package.json             (@fleet/client)
      tsconfig.json
      vite.config.ts
      src/
```

## What Goes Where

### `@fleet/types` — the shared contract
Contains everything that defines **data shapes**. Both server and client depend on it.

| What | Why it belongs here |
|------|-------------------|
| Zod schemas (`schemas.ts`) | Define the canonical shape of JSONL records and parsed messages |
| Inferred types (`messages.ts`) | `ParsedMessage`, `ContentBlock`, `TokenUsage`, etc. via `z.infer<>` |
| Enrichment interfaces (`enrichments.ts`) | `Turn`, `EnrichedSession`, `PairedToolCall`, etc. — already plain TS interfaces |
| `ModelPricing` interface | Data shape, not implementation |
| Scanner types (`scanner.ts`) | `ProjectSummary`, `SessionSummary` — shared API response shapes |

**`@fleet/types` depends on `zod`** — the schemas are the source of truth for types via `z.infer<>`. The client uses `import type { ... }` from this package, so Zod is never bundled into the browser. This avoids duplicating 326 lines of schema definitions as plain interfaces.

### `@fleet/server` — all implementation logic
Contains every server-side component as an internal module with barrel exports.

| Module | Contains | Imports from `@fleet/types` |
|--------|---------|---------------------------|
| `parser/` | `parseLine`, `enrichSession`, `parseFullSession` | Schemas for validation, types for return values |
| `parser/pricing.ts` | `lookupPricing`, `computeCost`, pricing table | `ModelPricing` interface |
| `scanner/` | `scanProjects`, `scanSessions`, `extractSessionSummary` | Scanner types, `ModelPricing` |
| `watcher/` (future) | File tailing, debounced flush | `ParsedMessage` |
| `api/` (future) | HTTP endpoints | All response types |
| `transport/` (future) | WebSocket relay | `ParsedMessage` |
| `controller/` (future) | CLI subprocess management | — |

### `@fleet/client` (future)
Browser app. Depends on `@fleet/types` for type-safe API consumption. Communicates with server via HTTP/WebSocket, no code-level dependency on `@fleet/server`.

## Dependency Graph

```
@fleet/types  (zod)
     ↑
@fleet/server (zod, @fleet/types)

@fleet/client (@fleet/types, react, vite, etc.)
```

No circular dependencies. Types is foundational. Server and client depend on types but not on each other.

## Configuration Details

### Root `package.json`
```jsonc
{
  "name": "fleet",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test packages/",
    "typecheck": "tsc --build"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "typescript": "^5.9.3"
  }
}
```

### Root `tsconfig.json`
```jsonc
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "declaration": true,
    "composite": true,
    "types": ["bun"]
  },
  "references": [
    { "path": "packages/types" },
    { "path": "packages/server" }
  ]
}
```

### `packages/types/package.json`
```jsonc
{
  "name": "@fleet/types",
  "version": "0.0.1",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.3.6" }
}
```

### `packages/server/package.json`
```jsonc
{
  "name": "@fleet/server",
  "version": "0.0.1",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@fleet/types": "workspace:*",
    "zod": "^4.3.6"
  }
}
```

**No build step** for types or server — Bun resolves `.ts` directly via the `exports` field. The only package needing a build step will be `@fleet/client` (Vite for browser).

## Implementation Steps

### Step 1: Create workspace root
- Update root `package.json`: add `"private": true`, `"workspaces": ["packages/*"]`, move shared devDeps to root, remove `zod` from root
- Update root `tsconfig.json`: add `composite`, `declaration`, replace `include` with `references`
- Create `packages/` directory

### Step 2: Create `@fleet/types`
- Create `packages/types/package.json` and `tsconfig.json`
- Move `src/parser/schemas.ts` → `packages/types/src/schemas.ts`
- Move Zod-inferred types from `src/parser/types.ts` → `packages/types/src/messages.ts`
- Move enrichment interfaces from `src/parser/types.ts` → `packages/types/src/enrichments.ts`
- Move `ModelPricing` interface from `src/parser/pricing.ts` → `packages/types/src/pricing.ts`
- Create `packages/types/src/index.ts` barrel that re-exports everything

### Step 3: Create `@fleet/server`
- Create `packages/server/package.json` and `tsconfig.json`
- Move `src/parser/` → `packages/server/src/parser/`
  - Update imports: schemas and types now come from `@fleet/types`
  - `pricing.ts` keeps `lookupPricing`, `computeCost`, and pricing table; imports `ModelPricing` from `@fleet/types`
  - Remove `types.ts` (moved to types package) and `schemas.ts` (moved to types package)
- Move scanner source → `packages/server/src/scanner/`
  - Update `extract-session-summary.ts`: import `computeCost` from `../parser` (sibling module) instead of `../../parser/pricing`
- Create `packages/server/src/index.ts` barrel that re-exports parser and scanner public APIs

### Step 4: Cleanup and verify
- Remove empty `src/` directory
- Run `bun install` to create workspace symlinks
- `bun test packages/` — all tests pass
- `bun run typecheck` — type checking passes across packages

## Key Tradeoff: Zod in `@fleet/types`

The types package depends on `zod` because the message types are derived from Zod schemas via `z.infer<>`. This is intentional:

**Why this is fine:**
- The schemas ARE the type definitions — they're the single source of truth for data shapes
- The client uses `import type { ParsedMessage } from "@fleet/types"` — `import type` is erased at compile time, so Zod is never bundled into the browser
- The alternative (rewriting 326 lines of schemas as plain interfaces) creates duplication and drift risk between schemas and types

**When this would become a problem:**
- If the client needs to do runtime imports from `@fleet/types` (e.g., importing a constant), Zod would enter the bundle. Solution: keep runtime exports (constants, utility functions) Zod-free, or use subpath exports (`@fleet/types/constants`).

## Files to Modify

| Current path | Destination |
|-------------|-------------|
| `package.json` | Update in place (workspace root config) |
| `tsconfig.json` | Update in place (project references) |
| `src/parser/schemas.ts` | `packages/types/src/schemas.ts` |
| `src/parser/types.ts` (Zod-inferred portion) | `packages/types/src/messages.ts` |
| `src/parser/types.ts` (enrichment interfaces) | `packages/types/src/enrichments.ts` |
| `src/parser/pricing.ts` (ModelPricing interface) | `packages/types/src/pricing.ts` |
| `src/parser/pricing.ts` (functions + table) | `packages/server/src/parser/pricing.ts` |
| `src/parser/parse-line.ts` | `packages/server/src/parser/parse-line.ts` |
| `src/parser/enrich-session.ts` | `packages/server/src/parser/enrich-session.ts` |
| `src/parser/parse-full-session.ts` | `packages/server/src/parser/parse-full-session.ts` |
| `src/parser/index.ts` | `packages/server/src/parser/index.ts` |
| `src/parser/__tests__/*` | `packages/server/src/parser/__tests__/*` |

## Verification
- `bun install` from root succeeds, creates workspace symlinks
- `bun test packages/server` runs all parser and scanner tests, all pass
- `bun run typecheck` (`tsc --build`) type-checks all packages with correct dependency ordering
- Server imports types from `@fleet/types` (not relative paths across package boundaries)
- Scanner imports `computeCost` from `../parser` (sibling server module), not cross-package relative paths
