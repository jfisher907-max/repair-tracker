import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import SWRegister from "@/components/SWRegister";

const barlow = Barlow({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Customer-facing documents (quotes/invoices) use their own faces so the
// paper reads distinct from the app chrome.
const inter = Inter({
  variable: "--font-doc-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-doc-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Repair Tracker",
  description: "Customers, vehicles, jobs, parts, and receipts for the shop.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Repair Tracker",
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
  return (
    <html lang="en">
      <body className={`${barlow.variable} ${barlowCondensed.variable} ${inter.variable} ${spaceGrotesk.variable}`}>
        <SWRegister />
        {children}
      </body>
    </html>
  );
}
