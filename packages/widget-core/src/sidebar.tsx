import type { WidgetConversation } from "@deskbell/shared";

/** The strings the sidebar needs; a subset of the widget's copy. */
export interface SidebarCopy {
  threads: string;
  showThreads: string;
  hideThreads: string;
  newChat: string;
  noRecent: string;
  deleteThread: string;
  confirmDelete: string;
  cancel: string;
  threadsError: string;
  retry: string;
  scopeThis: string;
  scopeAll: string;
}

export interface SidebarProps {
  conversations: WidgetConversation[];
  activeId: string | null;
  loading: boolean;
  error: boolean;
  collapsed: boolean;
  /** The thread whose delete is awaiting confirmation. */
  confirmId: string | null;
  /** Present when a scope key matches the page's context: "this" vs "all". */
  scope: { all: boolean; onChange: (all: boolean) => void } | null;
  copy: SidebarCopy;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
  onRetry: () => void;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

/**
 * The thread list as a left rail (spec: widget-thread-sidebar). Collapsible to
 * an icon column; each row opens its thread, and delete asks once, inline,
 * before it acts. The panel owns every piece of state; this only renders it.
 */
export function Sidebar(p: SidebarProps) {
  const { copy } = p;
  return (
    <aside
      class={`sidebar${p.collapsed ? " collapsed" : ""}`}
      part="sidebar"
      aria-label={copy.threads}
    >
      <div class="sidebar-head" part="sidebar-head">
        <button
          type="button"
          class="sidebar-btn"
          part="sidebar-toggle"
          aria-label={p.collapsed ? copy.showThreads : copy.hideThreads}
          aria-expanded={!p.collapsed}
          onClick={p.onToggle}
        >
          <Icon d={p.collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
        </button>
        {p.collapsed ? null : (
          <span class="sidebar-title" part="sidebar-title">
            {copy.threads}
          </span>
        )}
        <button type="button" class="sidebar-btn new" part="new-thread-button" onClick={p.onNew}>
          <Icon d="M12 5v14M5 12h14" />
          {p.collapsed ? null : <span>{copy.newChat}</span>}
        </button>
      </div>
      {p.collapsed ? null : (
        <>
          {p.scope ? (
            <div class="scope" role="tablist" part="scope-tabs">
              <button
                type="button"
                role="tab"
                part="scope-tab"
                class={`scope-tab${p.scope.all ? "" : " on"}`}
                aria-selected={!p.scope.all}
                onClick={() => p.scope?.onChange(false)}
              >
                {copy.scopeThis}
              </button>
              <button
                type="button"
                role="tab"
                part="scope-tab"
                class={`scope-tab${p.scope.all ? " on" : ""}`}
                aria-selected={p.scope.all}
                onClick={() => p.scope?.onChange(true)}
              >
                {copy.scopeAll}
              </button>
            </div>
          ) : null}
          <div class="threads">
            {p.error ? (
              <div class="sidebar-note">
                {copy.threadsError}{" "}
                <button type="button" class="link" onClick={p.onRetry}>
                  {copy.retry}
                </button>
              </div>
            ) : p.loading && p.conversations.length === 0 ? (
              <div class="sidebar-note">
                <span class="typing" role="status" aria-label="Loading">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : p.conversations.length === 0 ? (
              <div class="sidebar-note">{copy.noRecent}</div>
            ) : (
              p.conversations.map((c) => (
                <div class="thread-row" key={c.id}>
                  {p.confirmId === c.id ? (
                    <div class="thread-confirm" part="thread-confirm">
                      <span>{copy.confirmDelete}</span>
                      <div class="thread-confirm-actions">
                        <button type="button" class="link" onClick={() => p.onConfirm(null)}>
                          {copy.cancel}
                        </button>
                        <button type="button" class="link danger" onClick={() => p.onDelete(c.id)}>
                          {copy.deleteThread}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        class={`thread${c.id === p.activeId ? " on" : ""}`}
                        part="thread"
                        aria-current={c.id === p.activeId ? "true" : undefined}
                        onClick={() => p.onOpen(c.id)}
                      >
                        <span class="thread-title" part="thread-title">
                          {c.title}
                        </span>
                        <span class="thread-meta" part="thread-meta">
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="thread-delete"
                        part="thread-delete"
                        aria-label={`${copy.deleteThread}: ${c.title}`}
                        onClick={() => p.onConfirm(c.id)}
                      >
                        <Icon d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
