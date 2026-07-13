import "@testing-library/jest-dom/vitest";

// next/image resolves `src` via `new URL(...)`, so components that build image
// URLs from NEXT_PUBLIC_SUPABASE_URL need a valid value even when .env.local
// isn't present in this checkout (e.g. a fresh git worktree). Real env values
// (from .env.local / CI) take precedence — this is a fallback only.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
