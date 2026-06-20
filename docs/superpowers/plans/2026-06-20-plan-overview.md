# Implementation Plan Overview

The spec (`docs/superpowers/specs/2026-06-20-yard-map-design.md`) is large and is being
implemented as a **sequence of plans**, each producing working, testable software on its
own. Write each plan's detail only when the prior plan is working (so it reflects real code).

| # | Plan | Status | File |
|---|------|--------|------|
| 1 | Foundation & Data Layer — app shell, Supabase schema, seeded catalog/zones/vendors | **Written** | `2026-06-20-plan-1-foundation-data-layer.md` |
| 2 | Edit Gate & Write Infra — password unlock, signed cookie, gated server write-route pattern, RLS verification | Not yet written | — |
| 3 | Map View & Zone Panel — accurate survey-traced base map, zones from shape data, tap → detail panel (plants, photos, purchases), zone-photos storage bucket | Not yet written | — |
| 4 | Purchase Tracker — table CRUD, sort/filter, vendor inline-add, auto-add-to-plant-list, CSV import/export | Not yet written | — |
| 5 | Zone Shape Editor — polygon draw/edit over survey image, save normalized coords | Not yet written | — |
| 6 | Styling & Deploy — BHL botanical aesthetic, hand-lettered labels, Vercel deploy, mobile QA | Not yet written | — |

## Ordering note
The edit gate (Plan 2) is pulled **earlier** than spec §8 (which had it as Phase 6). Reason:
all write features depend on it, so building the auth boundary first means the tracker and
editor routes are gated from the start rather than retrofitted.

## Deferred to v2 (not in any plan above)
Google SSO; through-the-seasons photo timelines; plant detail pages; spend/inventory
analytics. See spec §11.

## Execution
Use `superpowers:subagent-driven-development` (fresh subagent per task, review between) or
`superpowers:executing-plans` (inline, batched checkpoints). DB tasks need the Supabase MCP
authenticated and `.env.local` populated.
