"use client";
import { useState } from "react";
import Image from "next/image";
import type { AreaSection, ZoneGroup } from "@/lib/zones";
import type { Zone, ZonePhoto } from "@/lib/types";
import { publicPhotoUrl } from "@/lib/photos";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

async function patchReview(ids: string[], action: "confirm" | "reassign" | "reject", zone_id?: string) {
  const res = await fetch("/api/zone-photos/review", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, action, zone_id }),
  });
  if (!res.ok) throw new Error(await res.text());
}

function Thumb({
  photo,
  zones,
  onDone,
}: {
  photo: ZonePhoto;
  zones: Zone[];
  onDone: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const run = async (action: "reassign" | "reject", zone_id?: string) => {
    setBusy(true);
    setErr(false);
    try {
      await patchReview([photo.id], action, zone_id);
      onDone(photo.id);
    } catch {
      setErr(true);
      setBusy(false);
    }
  };
  return (
    <figure style={{ margin: 0, position: "relative", opacity: busy ? 0.5 : 1 }}>
      <Image
        src={publicPhotoUrl(SUPABASE_URL, photo.storage_path)}
        alt={photo.caption ?? "pending photo"}
        width={110}
        height={83}
        style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #cbb994", display: "block" }}
      />
      {photo.ai_confidence != null && (
        <span style={{ position: "absolute", top: 3, left: 3, background: "rgba(63,74,46,0.85)", color: "#fff", fontSize: 9, padding: "1px 4px", borderRadius: 4 }}>
          {photo.ai_confidence.toFixed(2)}
        </span>
      )}
      <figcaption style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <select
          aria-label="Reassign zone"
          defaultValue=""
          disabled={busy}
          onChange={(e) => e.target.value && run("reassign", e.target.value)}
          style={{ fontSize: 10, flex: 1, minWidth: 0, border: "1px solid #cbb994", borderRadius: 3, background: "#f5efe0" }}
        >
          <option value="">move…</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </select>
        <button onClick={() => run("reject")} disabled={busy} aria-label="Reject" style={{ border: "none", background: "transparent", color: "#8e3b5e", cursor: "pointer", fontSize: 11 }}>
          ✕
        </button>
      </figcaption>
      {err && <span style={{ color: "#8e3b5e", fontSize: 9 }}>failed</span>}
    </figure>
  );
}

function Group({ group, zones }: { group: ZoneGroup; zones: Zone[] }) {
  const [remaining, setRemaining] = useState<ZonePhoto[]>(group.photos);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remove = (id: string) => setRemaining((r) => r.filter((p) => p.id !== id));

  const confirmAll = async () => {
    if (!group.zoneId) return;
    setBusy(true);
    setErr(null);
    try {
      await patchReview(remaining.map((p) => p.id), "confirm", group.zoneId);
      setRemaining([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (remaining.length === 0) return null;
  return (
    <div style={{ background: "#f5efe0", border: "1px solid #cbb994", borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: "#3f4a2e" }}>
          <b>{group.zoneName}</b> <span style={{ color: "#8a8268", fontSize: 12 }}>· {remaining.length}</span>
        </div>
        <button onClick={confirmAll} disabled={busy} style={{ background: "#3f4a2e", border: "none", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
          Confirm all correct
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
        {remaining.map((p) => (
          <Thumb key={p.id} photo={p} zones={zones} onDone={remove} />
        ))}
      </div>
      {err && <p style={{ color: "#8e3b5e", fontSize: 12 }}>{err}</p>}
    </div>
  );
}

function AreaOnlyBucket({ photos, label, zones }: { photos: ZonePhoto[]; label: string; zones: Zone[] }) {
  const [remaining, setRemaining] = useState<ZonePhoto[]>(photos);
  const remove = (id: string) => setRemaining((r) => r.filter((p) => p.id !== id));
  if (remaining.length === 0) return null;
  return (
    <div style={{ background: "#f5efe0", border: "1px solid #d8b58c", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 14, color: "#8a5a2e", marginBottom: 8 }}>
        <b>{label} — needs a bed</b>{" "}
        <span style={{ color: "#8a8268", fontSize: 12 }}>· {remaining.length} · pick a zone to confirm</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
        {remaining.map((p) => (
          <Thumb key={p.id} photo={p} zones={zones} onDone={remove} />
        ))}
      </div>
    </div>
  );
}

export default function ReviewTab({ sections, zones }: { sections: AreaSection[]; zones: Zone[] }) {
  if (sections.length === 0)
    return (
      <div data-testid="tab-review">
        <p style={{ color: "#8a8268" }}>Nothing pending — the queue is clear.</p>
      </div>
    );
  return (
    <div data-testid="tab-review">
      {sections.map((section) => (
        <section key={section.label} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: "#3f4a2e", borderBottom: "1px solid #cbb994", paddingBottom: 4, marginBottom: 10 }}>
            {section.label}
          </div>
          {section.groups.map((g) => (
            <Group key={g.zoneSlug ?? "none"} group={g} zones={zones} />
          ))}
          <AreaOnlyBucket photos={section.areaOnly} label={section.label} zones={zones} />
        </section>
      ))}
    </div>
  );
}
