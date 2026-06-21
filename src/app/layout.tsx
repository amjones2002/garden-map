import type { Metadata, Viewport } from "next";
import { Geist, Caveat } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import EditToggle from "@/components/EditToggle";
import { EditModeProvider } from "@/lib/edit-mode";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Berkner Park Garden Map",
  description:
    "An illustrated, mobile-first map of a Texas prairie & desert native-plant garden — explore the zones, plants, and growing notes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3f4a2e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <EditModeProvider>
          <EditToggle />
          <main style={{ paddingBottom: 64 }}>{children}</main>
          <Nav />
        </EditModeProvider>
      </body>
    </html>
  );
}
