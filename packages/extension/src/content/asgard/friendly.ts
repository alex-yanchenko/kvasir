// Human-readable copy for bridge failures — maps the raw transport/bridge error
// strings to actionable words. Its own module (not chat.ts) because the pairing
// machine needs it too and chat imports pairing: chat → pairing → friendly.
export function friendlyError(
  r: { data?: unknown; error?: string },
  fallback = "No answer came back.",
): string {
  const fromData =
    typeof r.data === "object" && r.data !== null && "error" in r.data && typeof r.data.error === "string"
      ? r.data.error
      : "";
  const event = fromData || r.error || "";
  if (/not paired/i.test(event)) return "Not paired — open Settings (gear) and pair the extension.";
  if (/timed out/i.test(event))
    return "No response yet — the session may be busy or paused in your terminal.";
  if (/refresh the page/i.test(event)) return "Extension was reloaded — refresh the page, then retry.";
  if (/fetch|reach|no response|network/i.test(event))
    return "Can't reach the channel — is your Claude session running?";
  return event ? `Something went wrong: ${event}` : fallback;
}
