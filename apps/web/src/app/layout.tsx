import type { Metadata, Viewport } from "next";
import "./globals.css";
import AccessGuard from "@/components/AccessGuard";
import { I18nProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Trusty — your social universe as a graph",
  description:
    "A graph-native social network: people, books, music, films, places and signals as one living constellation of nodes and edges.",
};

export const viewport: Viewport = {
  themeColor: "#070b18",
  width: "device-width",
  initialScale: 1,
  // Let the mobile trust-search view own the whole viewport height cleanly.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Loaded at runtime in the browser (build environments may be offline). */}
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@600..800&family=Spline+Sans:wght@300..700&family=Spline+Sans+Mono:wght@400..600&family=Vazirmatn:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <div className="nebula" aria-hidden />
        {/* Locale + direction live here: the provider stamps lang/dir on <html>,
            so every surface flips to RTL without per-component branching. */}
        <I18nProvider>
          <AccessGuard />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
