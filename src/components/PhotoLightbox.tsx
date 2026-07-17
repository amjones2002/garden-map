"use client";
import { useEffect, useState } from "react";
import PhotoMeta, { type PhotoMetaProps } from "./PhotoMeta";

export type PhotoLightboxProps = {
  src: string;
  alt: string;
  meta: PhotoMetaProps;
  onClose: () => void;
  /** When provided, a delete control is shown (edit mode). Should remove the photo and close. */
  onDelete?: () => Promise<void>;
  /** When provided, a left arrow steps to the previous photo. */
  onPrev?: () => void;
  /** When provided, a right arrow steps to the next photo. */
  onNext?: () => void;
};

export default function PhotoLightbox({ src, alt, meta, onClose, onDelete, onPrev, onNext }: PhotoLightboxProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, onClose]);

  const runDelete = async () => {
    if (!onDelete) return;
    setBusy(true);
    setErr(false);
    try {
      await onDelete();
    } catch {
      setErr(true);
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#f5efe0", borderRadius: 10, overflow: "hidden", maxWidth: "min(94vw, 900px)", maxHeight: "92vh", display: "flex", flexWrap: "wrap" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} style={{ flex: "1 1 320px", minWidth: 260, maxHeight: "92vh", objectFit: "contain", background: "#000", display: "block" }} />
        <div style={{ flex: "1 1 240px", maxWidth: 340, overflowY: "auto", maxHeight: "92vh" }}>
          <PhotoMeta {...meta} />
          {onDelete && (
            <div style={{ padding: "0 16px 16px" }}>
              {confirming ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "#5a5340" }}>Delete this photo?</span>
                  <button
                    onClick={runDelete}
                    disabled={busy}
                    style={{ background: "#8e3b5e", border: "none", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    style={{ background: "#efe7d3", border: "1px solid #cbb994", color: "#5a5340", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  style={{ background: "transparent", border: "1px solid #8e3b5e", color: "#8e3b5e", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
                >
                  Delete photo
                </button>
              )}
              {err && <p style={{ color: "#8e3b5e", fontSize: 12, margin: "8px 0 0" }}>Delete failed — try again.</p>}
            </div>
          )}
        </div>
      </div>
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous photo"
          style={{ position: "absolute", top: "50%", left: 16, transform: "translateY(-50%)", background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", fontSize: 28, lineHeight: 1, cursor: "pointer", borderRadius: "50%", width: 48, height: 48 }}
        >
          ‹
        </button>
      )}
      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next photo"
          style={{ position: "absolute", top: "50%", right: 16, transform: "translateY(-50%)", background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", fontSize: 28, lineHeight: 1, cursor: "pointer", borderRadius: "50%", width: 48, height: 48 }}
        >
          ›
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close photo"
        style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.55)", border: "none", color: "#fff", fontSize: 24, lineHeight: 1, cursor: "pointer", borderRadius: 4, width: 40, height: 40 }}
      >
        ×
      </button>
    </div>
  );
}
