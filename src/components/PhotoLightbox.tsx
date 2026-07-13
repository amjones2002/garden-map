"use client";
import PhotoMeta, { type PhotoMetaProps } from "./PhotoMeta";

export type PhotoLightboxProps = { src: string; alt: string; meta: PhotoMetaProps; onClose: () => void };

export default function PhotoLightbox({ src, alt, meta, onClose }: PhotoLightboxProps) {
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
        </div>
      </div>
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
