import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/providers/app-providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zuria.vercel.app";
const OG_TITLE = "ZURIA — AI Business Assistant for African Businesses";
const OG_DESC = "AI Business Assistant with WhatsApp + Telegram integration. Track sales, debts & profit in your language — no accountant needed. Built for Ghanaian traders.";

export const metadata: Metadata = {
  title: OG_TITLE,
  description: OG_DESC,
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ZURIA",
  },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESC,
    url: APP_URL,
    siteName: "ZURIA",
    type: "website",
    locale: "en_GH",
  },
  twitter: {
    card: "summary",
    title: OG_TITLE,
    description: OG_DESC,
  },
  metadataBase: new URL(APP_URL),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#071514",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
