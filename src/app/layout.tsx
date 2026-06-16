import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { AppShell } from "@/components/shell/AppShell";
import { getProfile } from "@/lib/auth/get-profile";
import { createClient } from "@/lib/supabase/server";

// Industrial-ledger type system: Archivo (sans) + IBM Plex Mono (IDs, figures),
// loaded at runtime via <link> (see <head> below) with a system-font fallback,
// rather than next/font's build-time fetch. The CSS var names (--font-sans /
// --font-mono) are defined in globals.css.

export const metadata: Metadata = {
  title: "Magnetic Joezion — Inventory",
  description: "Magnetic Joezion Nig. Ltd — material tracking and inventory system",
};

// Owner-only badge count: pending bulk sales awaiting approval.
async function ownerNotifications(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("bulk_sales")
    .select("id", { count: "exact", head: true })
    .eq("approval_status", "pending");
  return count ?? 0;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await getProfile();
  const notifications = profile?.role === "owner" ? await ownerNotifications() : 0;

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
        <ThemeProvider>
          <AppShell
            profile={
              profile
                ? { role: profile.role, fullName: profile.full_name, username: profile.username }
                : null
            }
            notifications={notifications}
          >
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
