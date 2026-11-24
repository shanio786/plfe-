---
name: Tax date semantics
description: Why account defaults follow date-resolved families while document selections and historical evidence remain pinned.
---

Account tax defaults represent a family whose applicable version follows the
document date; explicit selections and posted evidence remain version-specific.

**Why:** a scheduled rate change must not require changing every account, or
rewrite the rate/evidence attached to an older document.

**How to apply:** preserve the distinction when changing account selectors,
default resolution, draft review and historical notes. Closing a used open-ended
range is necessary to schedule its successor, but may not exclude posted
originals or reopen an already closed used range. Historical notes inherit
original amounts/evidence rather than today's configuration.
