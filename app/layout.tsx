import type { Metadata, Viewport } from "next";
// The typefaces are files in app/fonts, not a download from Google during the
// build: a build that depends on Google's font server fails when that server
// answers differently, and it did (app/fonts/README.md).
//
// fonts.css declares the faces and sets five variables on <body>:
//   --font-body         Barlow            the app's text
//   --font-display      Barlow Condensed  headings and labels
//   --font-doc-body     Inter             customer paper (quotes, invoices), which
//   --font-doc-display  Space Grotesk     uses its own faces so it reads distinct
//                                         from the app chrome
//   --font-mono         IBM Plex Mono     ids only: J007, Q012, VINs. Money is NOT
//                                         mono; it is bold display, tabular figures
import "./fonts/fonts.css";
import "./globals.css";
import PreloadFonts from "./fonts/PreloadFonts";
import SWRegister from "@/components/SWRegister";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  metadataBase: new URL('https://wingsnthings.repair'),
  title: BRAND_NAME,
  description: "Quotes, invoices, jobs, parts, and receipts for the shop.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: BRAND_NAME,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover + safe-area padding keeps the installed-PWA status bar clean;
  // no maximumScale so receipt photos stay pinch-zoomable everywhere.
  viewportFit: "cover",
  themeColor: "#0b0e13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning: the public page's pre-paint script may set
  // data-line on <html> before React hydrates (app/(public)/page.tsx). It
  // covers this element's own attributes only, not anything inside it.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="app-fonts">
        <PreloadFonts />
        <SWRegister />
        {children}
      </body>
    </html>
  );
}
