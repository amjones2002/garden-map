"use client";
import { useEditMode } from "@/lib/edit-mode";
import ShapeEditor from "@/components/ShapeEditor";

export default function EditorPage() {
  const { unlocked, loading } = useEditMode();
  if (loading) return <p style={{ padding: 16 }}>…</p>;
  if (!unlocked) {
    return (
      <p style={{ padding: 16, color: "#7a6a44" }}>
        The shape editor is an editing tool. Tap “Unlock editing” (top-right) and enter the password to use it.
      </p>
    );
  }
  return <ShapeEditor />;
}
