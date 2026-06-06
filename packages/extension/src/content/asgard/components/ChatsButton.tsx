// The "Chats (N)" pill + the reopen-past-chats popover. Sessions live in the
// store; opening one goes through the legacy bridge until ChatWindow lands (D5).
import type { JSX } from "react";
import { useState, useSyncExternalStore } from "react";
import { chatStore } from "../chat";
import { chatSnippet, chatsStore, getSnapshot, subscribe } from "../store";

export function ChatsButton(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  useSyncExternalStore(subscribe, getSnapshot);
  const sessions = chatsStore.sessions();
  if (!sessions.length) return null;
  return (
    <>
      <button className="prw-pill prw-chats-btn" onClick={() => setOpen((o) => !o)}>
        Chats ({sessions.length})
      </button>
      {open && (
        <div className="prw-chats-list">
          {sessions.map((sess) => (
            <div className="prw-chats-item-row" key={sess.key}>
              <button
                className="prw-chats-item"
                title={chatSnippet(sess)}
                onClick={() => {
                  setOpen(false);
                  chatStore.open(sess);
                }}
              >
                {chatSnippet(sess)}
              </button>
              <button
                className="prw-chats-del"
                title="Delete this chat"
                onClick={() => chatsStore.dropSession(sess.key)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="prw-chats-clear"
            onClick={() => {
              chatsStore.clearSessions();
              setOpen(false);
            }}
          >
            Clear all chats
          </button>
        </div>
      )}
    </>
  );
}
