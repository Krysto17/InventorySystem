import type { MetadataRoute } from "next";

// PWA manifest (#9) — makes the app installable on Android ("Add to home
// screen") and launchable standalone. No web push; notifications stay in-app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Magnetic Joezion — Inventory",
    short_name: "Joezion",
    description: "Mining material tracking & inventory system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1c1917",
    theme_color: "#1c1917",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
