"use client";
import { useState } from "react";
import type { AreaSection } from "@/lib/zones";
import type { Zone } from "@/lib/types";

type Tab = "upload" | "review";

export default function PhotosTabs({
  sections,
  zones,
  pendingCount,
  initialTab,
}: {
  sections: AreaSection[];
  zones: Zone[];
  pendingCount: number;
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  void sections;
  void zones;

  const tabBtn = (active: boolean): React.CSSProperties => ({
    background: "transparent",
    border: "none",
    borderBottom: `2px solid ${active ? "#8e3b5e" : "transparent"}`,
    color: active ? "#3f4a2e" : "#8a8268",
    fontSize: 15,
    fontWeight: active ? 500 : 400,
    padding: "8px 12px",
    cursor: "pointer",
  });

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ color: "#3f4a2e", marginTop: 0 }}>Photos</h1>
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #cbb994", marginBottom: 14 }}>
        <button style={tabBtn(tab === "upload")} onClick={() => setTab("upload")}>
          Add new photos
        </button>
        <button style={tabBtn(tab === "review")} onClick={() => setTab("review")}>
          To review <span style={{ color: "#8e3b5e" }}>{pendingCount.toLocaleString()}</span>
        </button>
      </div>
      {tab === "upload" ? <div data-testid="tab-upload" /> : <div data-testid="tab-review" />}
    </div>
  );
}
