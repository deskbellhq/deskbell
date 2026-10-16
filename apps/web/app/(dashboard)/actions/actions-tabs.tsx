"use client";

import { Tabs, TabsList, TabsTrigger } from "@deskbell/ui/components/tabs";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The three views of the actions section (spec: actions-ia): the tools,
 * the servers they come from, and the log of what ran. Links styled as
 * tabs, so each view is a URL and the browser's back button works.
 */
const TABS = [
  { key: "tools", label: "Actions", href: "/actions" },
  { key: "servers", label: "Servers", href: "/actions/servers" },
  { key: "log", label: "Log", href: "/actions/log" },
] as const;

export function currentTab(pathname: string): (typeof TABS)[number]["key"] {
  if (pathname.startsWith("/actions/servers")) return "servers";
  if (pathname.startsWith("/actions/log")) return "log";
  return "tools";
}

export function ActionsTabs() {
  const pathname = usePathname();
  const value = currentTab(pathname);
  return (
    <Tabs value={value}>
      <TabsList aria-label="Actions views">
        {TABS.map((t) => (
          <TabsTrigger key={t.key} value={t.key} asChild>
            <Link href={t.href}>{t.label}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
