import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { AppShell } from "@/components/shell/AppShell";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { getProfile } from "@/lib/auth/get-profile";

// Industrial-ledger type system: Archivo (sans) + IBM Plex Mono (IDs, figures),
// loaded at runtime via <link> (see <head> below) with a system-font fallback,
// rather than next/font's build-time fetch. The CSS var names (--font-sans /
// --font-mono) are defined in globals.css.

export const metadata: Metadata = {
  title: "Magnetic Joezion — Inventory",
  description: "Magnetic Joezion Nig. Ltd — material tracking and inventory system",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Joezion" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1c1917",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The bell is filled in by the client after paint (AppShell fetches it on
  // mount and keeps it live over realtime). Blocking the whole shell on a
  // count query just to draw a badge made every navigation wait for it.
  const profile = await getProfile();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full">
        <ServiceWorkerRegister />
        <ThemeProvider>
          <AppShell
            profile={
              profile
                ? {
                    role: profile.role,
                    fullName: profile.full_name,
                    username: profile.username,
                    isGeneralManager: profile.is_general_manager,
                  }
                : null
            }
            notificationItems={[]}
          >
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
