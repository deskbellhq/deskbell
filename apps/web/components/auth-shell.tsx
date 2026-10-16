import Link from "next/link";
import { BellMark } from "@/components/bell-mark";

/**
 * Shared chrome for the auth pages (spec: register-login-pages): brand row,
 * large centered page title, centered card column. Server-safe on purpose —
 * only the forms inside are client components.
 */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-6 p-6 md:p-10">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <BellMark size={22} className="shrink-0 text-[#2b6b4f]" />
        Deskbell
      </Link>
      <h1 className="text-center text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
