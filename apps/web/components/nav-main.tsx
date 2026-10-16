"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@deskbell/ui/components/sidebar";
import { CirclePlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  /** Pages under this one that deserve their own entry; the parent stays a link. */
  items?: { title: string; url: string }[];
}

/**
 * A labelled run of entries. The label says what the entries have in
 * common — the agent's configuration, or what happened — so a page's place
 * in the sidebar explains itself. A group without a label is the top.
 */
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export function NavMain({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Ask a question"
                onClick={() => window.dispatchEvent(new Event("deskbell:open"))}
                className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              >
                <CirclePlus />
                <span>Ask a question</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {groups.map((group, i) => (
        <NavGroupMenu key={group.label ?? i} group={group} pathname={pathname} />
      ))}
    </>
  );
}

function NavGroupMenu({ group, pathname }: { group: NavGroup; pathname: string }) {
  return (
    <SidebarGroup className={group.label ? undefined : "pt-0"}>
      {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                asChild
                isActive={item.url === "/" ? pathname === "/" : pathname.startsWith(item.url)}
              >
                <Link href={item.url}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {item.items?.length ? (
                <SidebarMenuSub>
                  {item.items.map((sub) => (
                    <SidebarMenuSubItem key={sub.title}>
                      <SidebarMenuSubButton asChild isActive={pathname.startsWith(sub.url)}>
                        <Link href={sub.url}>
                          <span>{sub.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
