import type { Metadata, Viewport } from "next";
import "@fontsource-variable/cairo/index.css";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Ghamer CRM", template: "%s | Ghamer CRM" }, description: "نظام إدارة غامر", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#8B1E34" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
