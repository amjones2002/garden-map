"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type EditMode = {
  unlocked: boolean;
  loading: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
};

const Ctx = createContext<EditMode | null>(null);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/edit/status")
      .then((r) => r.json())
      .then((d) => setUnlocked(!!d.unlocked))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const unlock = useCallback(async (password: string) => {
    const r = await fetch("/api/edit/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const ok = r.ok;
    if (ok) setUnlocked(true);
    return ok;
  }, []);

  const lock = useCallback(async () => {
    await fetch("/api/edit/lock", { method: "POST" });
    setUnlocked(false);
  }, []);

  return <Ctx.Provider value={{ unlocked, loading, unlock, lock }}>{children}</Ctx.Provider>;
}

export function useEditMode(): EditMode {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditMode must be used within EditModeProvider");
  return v;
}
