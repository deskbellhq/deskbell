"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@deskbell/ui/components/sidebar";
import {
  ArrowLeft,
  Bell,
  CircleUser,
  Code2,
  Hourglass,
  KeyRound,
  type LucideIcon,
  Palette,
  SearchX,
  Tags,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

type SettingsItem = { title: string; url: string; icon: LucideIcon };

const accountGroup: SettingsItem[] = [
  { title: "Account", url: "/settings/account", icon: CircleUser },
];
const workspaceGroup: SettingsItem[] = [
  { title: "Members", url: "/settings/members", icon: Users },
  { title: "Gaps", url: "/settings/gaps", icon: SearchX },
  { title: "Topics", url: "/settings/topics", icon: Tags },
  { title: "Data retention", url: "/settings/retention", icon: Hourglass },
];
const widgetGroup: SettingsItem[] = [
  { title: "Appearance", url: "/settings/appearance", icon: Palette },
  { title: "Install", url: "/settings/install", icon: Code2 },
  { title: "Visitor identity", url: "/settings/identity", icon: KeyRound },
  { title: "Notifications", url: "/settings/notifications", icon: Bell },
];

function SettingsGroup({ label, items }: { label: string; items: SettingsItem[] }) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
              >
                <Link href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function SettingsSidebar({
  role,
  ...props
}: React.ComponentProps<typeof Sidebar> & { role: string }) {
  // Workspace is admin+ — hiding the group keeps the nav honest; the Members
  // page and its actions remain the real fence (spec: dashboard-auth).
  const canManageWorkspace = role === "owner" || role === "admin";
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="text-muted-foreground">
              <Link href="/">
                <ArrowLeft />
                <span>Back to app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SettingsGroup label="Account" items={accountGroup} />
        {canManageWorkspace && <SettingsGroup label="Workspace" items={workspaceGroup} />}
        <SettingsGroup label="Widget" items={widgetGroup} />
      </SidebarContent>
    </Sidebar>
  );
}
