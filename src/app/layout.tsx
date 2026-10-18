import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import "@/app/globals.css";

const THEME_INIT_SCRIPT = `(()=>{let theme="dark";try{const stored=localStorage.getItem("satulayar-theme");if(stored==="light"||stored==="dark")theme=stored}catch{}document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme})()`;

export const metadata: Metadata = {
  title: "Satulayar · Marketing Performance Dashboard",
  description:
    "One screen for paid media and store performance across every brand you manage.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
