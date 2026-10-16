import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "@deskbell/ui/globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Deskbell",
  description:
    "The bell on your product's front desk — open-source AI agent that answers from your docs and acts through MCP.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Font variables live on <html> so @font-face registration happens even
    // though @theme inline references the families by literal name.
    // suppressHydrationWarning covers attributes browser extensions stamp onto
    // <html> (LanguageTool, dark-mode tools) and <body> (Grammarly's
    // data-gr-ext-installed) before React hydrates. It only applies to the element
    // it sits on, so genuine mismatches below still warn.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
