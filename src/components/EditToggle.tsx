"use client";
import { useState } from "react";
import { useEditMode } from "@/lib/edit-mode";

const wrap: React.CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  zIndex: 60,
  display: "flex",
  gap: 6,
  alignItems: "center",
};

const btn: React.CSSProperties = {
  minHeight: 36,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #cbb994",
  background: "#f5efe0",
  color: "#3f4a2e",
  fontSize: 13,
  cursor: "pointer",
};

export default function EditToggle() {
  const { unlocked, loading, unlock, lock } = useEditMode();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return null;

  if (unlocked) {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 12, color: "#7aa329" }}>● editing</span>
        <button style={btn} onClick={() => lock()}>
          Lock
        </button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {open ? (
        <form
          style={{ display: "flex", gap: 6 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(false);
            const ok = await unlock(pw);
            setBusy(false);
            if (ok) {
              setOpen(false);
              setPw("");
            } else {
              setErr(true);
            }
          }}
        >
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="edit password"
            aria-label="edit password"
            style={{
              minHeight: 36,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${err ? "crimson" : "#cbb994"}`,
              fontSize: 13,
            }}
          />
          <button style={btn} type="submit" disabled={busy}>
            {busy ? "…" : "Unlock"}
          </button>
        </form>
      ) : (
        <button style={btn} onClick={() => setOpen(true)}>
          Unlock editing
        </button>
      )}
    </div>
  );
}
