"use client";
import { useEditMode } from "@/lib/edit-mode";
import LabelEditor from "@/components/LabelEditor";

export default function LabelsEditorPage() {
  const { unlocked, loading } = useEditMode();
  if (loading) return <p style={{ padding: 16 }}>…</p>;
  if (!unlocked) {
    return (
      <p style={{ padding: 16, color: "#7a6a44" }}>
        Managing text labels is an editing tool. Tap “Unlock editing” (top-right) to use it.
      </p>
    );
  }
  return <LabelEditor />;
}
