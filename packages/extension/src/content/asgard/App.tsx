// Asgard — the panel-UI realm. It never touches GitHub's page; everything
// crosses the Bifrost. Islands land here one by one
// (Settings ✓ → ChatsList ✓ → Launcher ✓ → TourCard ✓ → Chat ✓).
import type { JSX } from "react";
import { ChatsButton } from "./components/ChatsButton";
import { Launcher } from "./components/Launcher";
import { TourCard } from "./components/TourCard";
import { ChatWindow } from "./components/Chat";
import { Settings } from "./components/Settings";

export function App(): JSX.Element {
  return (
    <>
      <Settings />
      <ChatsButton />
      <Launcher />
      <TourCard />
      <ChatWindow />
    </>
  );
}
