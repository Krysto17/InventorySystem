import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { AppShell } from "@/components/shell/AppShell";
import { getProfile } from "@/lib/auth/get-profile";
import { createClient } from "@/lib/supabase/server";

// Industrial-ledger type system: Archivo (sans) + IBM Plex Mono (IDs, figures).
const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

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
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
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
