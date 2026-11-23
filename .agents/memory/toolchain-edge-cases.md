---
name: Toolchain edge cases
description: Generation, standalone packaging and validation-version compatibility.
---

Next.js 15 type generation can infer a `src/` source root merely because an empty
legacy scaffold directory remains, even when the App Router code is at the
application root.

**Why:** A Vite-to-Next conversion compiled but generated invalid imports pointing
at nonexistent `src/app` pages until the unused scaffold directories were removed.

**How to apply:** Do not leave both root and empty legacy source-directory layouts
around when converting scaffolds. Keep standard `npm start` output configuration;
Next's standalone output expects a different server/asset packaging path.

Orval can emit a TypeScript query-parameter type with the same exported name as
the Zod path-parameter schema for an operation combining path and query params.

**Why:** Code generation succeeded but the generated barrel failed type checking;
editing the barrel is ineffective because regeneration restores it.

**How to apply:** Address the naming/output configuration or contract shape at
the generator's source, never by hand-editing generated files.

Generate the standalone npm lockfile outside the pnpm-installed directory.

**Why:** npm's lock-only operation inspected existing pnpm symlinks and recorded
external workspace paths instead of the registry dependency tree. A passing pnpm
build therefore did not establish that a fresh VPS `npm ci` could work.

**How to apply:** Use the isolated lock-generation command after dependency
changes, reject external/link entries, and test clean npm packaging when release
dependencies change. Keep pnpm and standalone npm overrides aligned.

Upgrade the React Hook Form resolver alongside a move from Zod 3 to Zod 4.

**Why:** An older resolver can accept valid inputs but fail to translate Zod 4
validation errors into field errors. Server schema tests and a successful build
alone do not test that client bridge.

**How to apply:** Keep the resolver on a Zod 4-compatible release and test both
valid submissions and invalid field-error results whenever validation versions
change.
