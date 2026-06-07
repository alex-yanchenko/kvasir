// History tab — past chat sessions. Opening one routes into the Chat tab.
// Replaces the floating "Chats (N)" pill; chatsStore/chatStore are unchanged.
import type { JSX } from "react";
import { useSyncExternalStore } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { chatStore } from "../../chat";
import { chatSnippet, chatsStore, getSnapshot, PANEL_TABS, panelStore, subscribe } from "../../store";
import { Button } from "../../ui/button";

export function HistoryTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  const sessions = chatsStore.sessions();

  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <MessageSquare className="size-6 opacity-50" />
        No chats yet — select code or ask about the PR to start one.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {sessions.map((sess) => (
        <div key={sess.key} className="group flex items-center gap-1 rounded-md hover:bg-accent">
          <button
            className="flex-1 truncate px-2 py-2 text-left text-sm"
            title={chatSnippet(sess)}
            onClick={() => {
              chatStore.open(sess);
              panelStore.setTab(PANEL_TABS.CHAT);
            }}
          >
            {chatSnippet(sess)}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label="Delete this chat"
            onClick={() => chatsStore.dropSession(sess.key)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 self-start text-muted-foreground"
        onClick={() => chatsStore.clearSessions()}
      >
        Clear all chats
      </Button>
    </div>
  );
}
