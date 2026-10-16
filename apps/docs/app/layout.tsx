import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { baseOptions } from "@/lib/layout.shared";
import { appName, docsPrefix, searchApiUrl, siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";
import "./global.css";

const geistSans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl + docsPrefix),
  title: { default: `${appName} documentation`, template: `%s · ${appName}` },
  description:
    "Self-host Deskbell: an open-source answer engine that answers from your documentation with citations.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider
          // The client fetch does not inherit `basePath`, so an unprefixed
          // default would return nothing and look exactly like working search.
          search={{ options: { api: searchApiUrl } }}
        >
          <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}
