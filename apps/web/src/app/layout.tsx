import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@jarvis/ui/styles.css";
import "./web.css";
import "./responsive.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "F.R.I.D.A.Y. Command Center",
  description: "Lokales Kontrollzentrum für F.R.I.D.A.Y.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#01060c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-motion is rewritten at runtime from the settings (setMotionMode); the attribute differs between SSR and client.
    <html lang="de" data-motion="full" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
