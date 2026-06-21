# Plan 6 — Styling & Deploy

**Goal:** Give the app a warm, hand-drawn "vintage botanical / Biodiversity Heritage Library" feel (aged paper, wood-element palette, hand-lettered labels), then deploy to Vercel with a working public URL.

**Architecture:** Replace the dark scaffold theme with an aged-paper light theme + CSS variables for the wood-element palette (lime/chartreuse greens, burgundy accents, earthy neutrals). Add the *Caveat* hand-lettered font via `next/font/google` exposed as `--font-hand`; apply it to headings and map labels. Components already use on-palette colors, so this is mostly global theme + typography. Deploy: env vars already set in Vercel; pushing `main` triggers the linked GitHub build; poll the deployment to READY and verify.

## Tasks
1. **Theme** — rewrite `globals.css` (paper bg, palette vars, serif body, hand-lettered headings). Commit.
2. **Hand font + labels** — add Caveat in `layout.tsx`; apply `--font-hand` to map zone/street labels. Commit.
3. **Verify** — build + preview screenshot (warm theme, hand-lettered labels). Commit if tweaks.
4. **Deploy** — merge to main → push → poll Vercel deployment → verify public URL loads with live data. Record URL in README.

## Deploy notes
- Vercel project `garden-map` (prj_Lnfz0eKFBCk90PaHVWyemu0aAkc0), framework nextjs, env vars set (production+preview).
- App lives at repo root; Vercel root dir default.
