"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@deskbell/ui/components/command";
import {
  Bell,
  BookOpen,
  CirclePlus,
  CircleSlash,
  CircleUser,
  Code2,
  Database,
  Hourglass,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Palette,
  PenLine,
  Plug,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DOCS_URL } from "@/lib/links";

/**
 * ⌘K / Ctrl-K palette (spec: dashboard-ia-settings). Mounted once per shell;
 * navigation covers every page the current role can reach, and Ask a question
 * rings the same widget the sidebar button does.
 */
export function CommandPalette({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (url: string) => {
    setOpen(false);
    router.push(url);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Go to" description="Jump anywhere">
      <CommandInput placeholder="Type a page or action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              setOpen(false);
              window.dispatchEvent(new Event("deskbell:open"));
            }}
          >
            <CirclePlus />
            Ask a question
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go("/")}>
            <LayoutDashboard />
            Overview
          </CommandItem>
          <CommandItem onSelect={() => go("/sources")}>
            <Database />
            Sources
          </CommandItem>
          <CommandItem onSelect={() => go("/sources/answers")}>
            <PenLine />
            Written answers
          </CommandItem>
          <CommandItem onSelect={() => go("/conversations")}>
            <MessagesSquare />
            Conversations
          </CommandItem>
          <CommandItem onSelect={() => go("/gaps")}>
            <CircleSlash />
            Gaps
          </CommandItem>
          <CommandItem onSelect={() => go("/actions")}>
            <Plug />
            Actions
          </CommandItem>
          <CommandItem onSelect={() => go("/actions/log")}>
            <Plug />
            Actions log
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/account")}>
            <CircleUser />
            Account settings
          </CommandItem>
          {isAdmin && (
            <CommandItem onSelect={() => go("/settings/members")}>
              <Users />
              Members
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/settings/appearance")}>
            <Palette />
            Appearance
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/install")}>
            <Code2 />
            Install
          </CommandItem>
          {isAdmin && (
            <CommandItem onSelect={() => go("/settings/retention")}>
              <Hourglass />
              Data retention
            </CommandItem>
          )}
          <CommandItem onSelect={() => go("/settings/identity")}>
            <KeyRound />
            Visitor identity
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/notifications")}>
            <Bell />
            Notifications
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              window.open(DOCS_URL, "_blank", "noreferrer");
            }}
          >
            <BookOpen />
            Documentation
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
