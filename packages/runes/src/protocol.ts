/** The channel↔extension wire-protocol version — a single integer both sides
 * import from here and compare on the /health probe. Bump it on any BREAKING
 * change to the bridge's request/response shapes (a route's payload, an event's
 * meta contract) so a mismatched channel and extension surface a clear banner
 * instead of failing subtly. It is independent of the release VERSION (which
 * tracks the product and moves every release); the protocol number moves only
 * when the wire contract itself changes. The policy is exact-match — the channel
 * and extension must agree on this integer or the extension shows a skew banner. */
export const PROTOCOL_VERSION = 1;
