"use client";
import Link from "next/link";
import { useEditMode } from "@/lib/edit-mode";

export default function Nav() {
  const { unlocked } = useEditMode();
  const item: React.CSSProperties = { flex: 1, textAlign: "center", padding: "14px 0", minHeight: 44 };
  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        display: "flex",
        borderTop: "1px solid #cbb994",
        background: "#f5efe0",
        zIndex: 50,
      }}
    >
      <Link href="/" style={item}>Map</Link>
      <Link href="/tracker" style={item}>Tracker</Link>
      <Link href="/gallery" style={item}>Gallery</Link>
      {unlocked && (
        <Link href="/photos" style={{ ...item, color: "#8e3b5e" }}>Photos</Link>
      )}
    </nav>
  );
}
