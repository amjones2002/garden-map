import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import EditToggle from "@/components/EditToggle";
import { EditModeProvider } from "@/lib/edit-mode";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eastview Yard Map",
  description:
    "Interactive yard map & plant tracker for 1105 Eastview Cir — a taste of the Texas prairie and desert.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
