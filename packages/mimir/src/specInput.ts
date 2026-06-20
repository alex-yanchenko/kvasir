/**
 * Coerce + validate a walkthrough spec arriving over the MCP tool boundary.
 *
 * The MCP client may deliver the spec either as an object or as a JSON STRING:
 * an untyped tool param (JSON Schema with no `type`) gets serialized to a string
 * on the wire, while a typed object param arrives as an object. publish_walkthrough
 * must accept both, then validate the shape — and report the exact failing field
 * (path + message) so an author iterating on it isn't blind.
 *
 * This lives apart from channel.ts (the untestable MCP/Bun.serve wiring) so the
 * coerce-and-validate logic — the exact thing that silently broke — is unit-tested.
 */
import { WalkthroughSpecSchema, type WalkthroughSpec } from "@kvasir/runes";

export type SpecInputResult = { ok: true; spec: WalkthroughSpec } | { ok: false; error: string };

export function parseSpecInput(raw: unknown): SpecInputResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "spec arrived as a string but was not valid JSON" };
    }
  }
  const parsed = WalkthroughSpecSchema.safeParse(value);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const error = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error };
}
