import { Skeleton } from "@deskbell/ui/components/skeleton";

/** The thread slot while a row's page loads: header, then three bubbles. */
export default function ConversationLoading() {
  return (
    <div className="hidden h-full min-h-0 flex-1 flex-col md:flex" aria-busy="true">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="ml-auto h-5 w-16 rounded-full" />
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 lg:px-6">
        <div className="flex items-end gap-2">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-10 w-2/3 rounded-2xl" />
        </div>
        <Skeleton className="ml-8 h-24 w-3/4 rounded-2xl" />
        <div className="flex items-end gap-2">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
