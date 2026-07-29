import "~/styles/globals.css";

import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Space_Grotesk,
} from "next/font/google";

import {
  THEME_STORAGE_KEY,
  ThemeProvider,
} from "~/app/_components/theme-provider";
import { TRPCReactProvider } from "~/trpc/react";

const themeBootstrapScript = `(() => { try { const theme = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); if (theme === "light" || theme === "dark") { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } } catch {} })();`;

const displaySerif = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const displaySans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const bodySans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const codeMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-data",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AlphaFlow",
  description:
    "把筛选、行业研究、公司判断和择时研究压缩成一条连续工作流的研究前端。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script id="theme-bootstrap">{themeBootstrapScript}</script>
      </head>
      <body
        className={`${displaySerif.variable} ${displaySans.variable} ${bodySans.variable} ${codeMono.variable} antialiased`}
      >
        <ThemeProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
