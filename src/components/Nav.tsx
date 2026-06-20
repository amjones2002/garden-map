import Link from "next/link";

export default function Nav() {
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
      <Link
        href="/"
        style={{ flex: 1, textAlign: "center", padding: "14px 0", minHeight: 44 }}
      >
        Map
      </Link>
      <Link
        href="/tracker"
        style={{ flex: 1, textAlign: "center", padding: "14px 0", minHeight: 44 }}
      >
        Tracker
      </Link>
    </nav>
  );
}
