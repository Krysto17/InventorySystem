import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { AppShell } from "@/components/shell/AppShell";
import { getProfile } from "@/lib/auth/get-profile";
import { createClient } from "@/lib/supabase/server";

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
