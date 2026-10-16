"use client";

import { Button } from "@deskbell/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@deskbell/ui/components/dropdown-menu";
import { EllipsisVertical } from "lucide-react";
import { useTransition } from "react";

import { changeMemberRole, removeMember } from "@/app/settings/members/actions";

const ROLE_CHOICES = ["viewer", "editor", "admin"] as const;

/**
 * Role changes and removal for one member row. Owners are managed nowhere in
 * v1 (no transfer, no demotion) and you cannot act on yourself — the plugin
 * enforces both server-side; hiding the controls just keeps the UI honest.
 */
export function MemberRowActions({
  memberId,
  role,
  isSelf,
}: {
  memberId: string;
  role: string;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (role === "owner" || isSelf) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending} aria-label="Member actions">
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Change role</DropdownMenuLabel>
        {ROLE_CHOICES.filter((r) => r !== role).map((r) => (
          <DropdownMenuItem
            key={r}
            onClick={() => startTransition(() => changeMemberRole(memberId, r))}
          >
            Make {r}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => startTransition(() => removeMember(memberId))}
        >
          Remove from instance
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
