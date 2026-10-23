"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@deskbell/ui/components/sidebar";
import {
  BookOpen,
  ChartColumn,
  CircleSlash,
  Database,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  Settings,
} from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { BellMark } from "@/components/bell-mark";
import { GithubStarCard } from "@/components/github-star-card";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { DOCS_URL } from "@/lib/links";

/**
 * Product surfaces only (spec: dashboard-ia-settings) — configuration lives
 * under /settings in its own shell, reached through the footer entry. Nothing
 * here links to a page that does not exist. Written answers are a child of
 * Sources (spec: written-answers-naming): the command palette and the proxy
 * matcher list the same pages.
 */
// Three groups: the summary, what the agent knows and can do, what happened.
const data = {
  navGroups: [
    { items: [{ title: "Overview", url: "/", icon: LayoutDashboard }] },
    {
      label: "Agent",
      items: [
        {
          title: "Sources",
          url: "/sources",
          icon: Database,
          items: [{ title: "Written answers", url: "/sources/answers" }],
        },
        { title: "Actions", url: "/actions", icon: Plug },
      ],
    },
    {
      label: "Activity",
      items: [
        { title: "Conversations", url: "/conversations", icon: MessagesSquare },
        { title: "Gaps", url: "/gaps", icon: CircleSlash },
        { title: "Usage", url: "/usage", icon: ChartColumn },
      ],
    },
  ],
  navFooter: [
    { title: "Settings", url: "/settings", icon: Settings },
    { title: "Documentation", url: DOCS_URL, icon: BookOpen, external: true },
  ],
};

export function AppSidebar({
  user,
  starBadge,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string };
  starBadge?: React.ReactNode;
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <Link href="/">
                <BellMark size={20} className="shrink-0 text-[#2b6b4f]" />
                <span className="text-base font-semibold">Deskbell</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={data.navGroups} />
        <div className="mt-auto">
          <GithubStarCard badge={starBadge} />
          <NavSecondary items={data.navFooter} />
        </div>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ ...user, avatar: "" }} />
      </SidebarFooter>
    </Sidebar>
  );
}
