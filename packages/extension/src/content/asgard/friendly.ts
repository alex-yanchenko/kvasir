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
  // A non-JSON body (an HTML error page) reaches here as the worker's cleaned
  // "non-JSON response" signal, or — from an older channel — the raw V8 JSON.parse
  // text ("Unexpected token '<', "<!DOCTYPE "... is not valid JSON"). It means
  // something answered on the port but not with JSON: a restarting/wedged channel,
  // a throwing route's error page, or another app on 8799.
  if (/non-json|not valid json|unexpected token|<!doctype/i.test(event))
    return "The channel sent an unexpected response — it may be restarting, or another app may be using port 8799. Restart kvasir, then retry.";
  return event ? `Something went wrong: ${event}` : fallback;
}
