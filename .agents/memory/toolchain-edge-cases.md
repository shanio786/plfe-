---
name: Toolchain edge cases
description: Subtle generation behavior encountered with Next.js 15 and Orval.
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
