import type { Metadata } from "next";
import { connection } from "next/server";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { loadProfileForRequest } from "@/server/services/system";

export const metadata: Metadata = {
  title: "Cockpit / Hermes",
  description: "A local, read-only observability surface for Hermes.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const profile = await loadProfileForRequest();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AppShell profile={profile}>{children}</AppShell>
      </body>
    </html>
  );
}
