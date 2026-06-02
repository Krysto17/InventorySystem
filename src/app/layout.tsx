import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Magnetic Joezion — Inventory",
  description: "Magnetic Joezion Nig. Ltd — material tracking and inventory system",
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
      <body className="min-h-full flex flex-col bg-gray-50">
        <div className="bg-black text-white text-xs px-4 py-1.5 flex items-center gap-2 shrink-0">
          <span className="font-semibold tracking-wide">MAGNETIC JOEZION NIG. LTD</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-300">Inventory &amp; Material Tracking</span>
        </div>
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
