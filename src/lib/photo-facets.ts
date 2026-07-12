export type CanonicalColor =
  | "pink" | "red" | "purple" | "blue" | "white" | "yellow"
  | "orange" | "green" | "coral" | "magenta" | "cream";

export const CANONICAL_COLORS: { key: CanonicalColor; label: string; hex: string }[] = [
  { key: "pink", label: "Pink", hex: "#e58bb0" },
  { key: "red", label: "Red", hex: "#c0392b" },
  { key: "purple", label: "Purple", hex: "#7b5aa6" },
  { key: "blue", label: "Blue", hex: "#4a72b0" },
  { key: "white", label: "White", hex: "#f2efe6" },
  { key: "yellow", label: "Yellow", hex: "#e5c84a" },
  { key: "orange", label: "Orange", hex: "#e08a3c" },
  { key: "green", label: "Green", hex: "#6f8150" },
  { key: "coral", label: "Coral", hex: "#e5795b" },
  { key: "magenta", label: "Magenta", hex: "#c1447e" },
  { key: "cream", label: "Cream", hex: "#eadfc0" },
];

// Keyword → canonical. First match wins; order matters (specific before generic).
const KEYWORDS: [string, CanonicalColor][] = [
  ["lavender", "purple"], ["violet", "purple"], ["lilac", "purple"], ["mauve", "purple"], ["purple", "purple"],
  ["magenta", "magenta"], ["fuchsia", "magenta"],
  ["coral", "coral"], ["salmon", "coral"], ["peach", "coral"],
  ["pink", "pink"], ["rose", "pink"],
  ["red", "red"], ["crimson", "red"], ["scarlet", "red"], ["burgundy", "red"],
  ["orange", "orange"], ["apricot", "orange"],
  ["yellow", "yellow"], ["gold", "yellow"],
  ["cream", "cream"], ["ivory", "cream"], ["off-white", "cream"],
  ["blue", "blue"], ["indigo", "blue"],
  ["white", "white"],
  ["green", "green"], ["chartreuse", "green"],
];

const NULLISH = new Set(["", "none", "n/a", "na", "unknown", "no blooms", "foliage"]);

export function normalizeBloomColor(raw: string): CanonicalColor | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || NULLISH.has(s)) return null;
  for (const [kw, canon] of KEYWORDS) if (s.includes(kw)) return canon;
  return null;
}
