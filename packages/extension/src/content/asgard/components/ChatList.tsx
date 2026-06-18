// The chat list — New chat, the open chats (active highlighted, each with a trash),
// and Clear all. Rendered in the global sidebar on the Chat tab. Several chats can
// run at once; pick any to view it in the main area.
import { Plus, Trash2 } from "lucide-react";
import type { JSX } from "react";
import { chatStore } from "../chat";
import { chatSnippet, chatsStore } from "../store";
import { Button } from "../ui/button";

export function ChatList(): JSX.Element {
  const sessions = chatsStore.sessions();
  const active = chatStore.active()?.key ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <Button size="sm" className="w-full" onClick={() => chatStore.newChat()}>
          <Plus /> New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {sessions.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet.</p>
        ) : (
          sessions.map((sess) => (
            <div
              key={sess.key}
              className={
                "group flex items-center rounded-md " +
                (sess.key === active ? "bg-accent" : "hover:bg-accent")
              }
            >
              <button
                className="flex-1 truncate px-2 py-1.5 text-left text-xs"
                title={chatSnippet(sess)}
                onClick={() => chatStore.open(sess)}
              >
                {chatSnippet(sess)}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                aria-label="Delete this chat"
                onClick={() => chatStore.deleteSession(sess.key)}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </div>
      {sessions.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="m-2 mt-1 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => chatsStore.clearSessions()}
        >
          <Trash2 /> Clear all
        </Button>
      )}
    </div>
  );
}
