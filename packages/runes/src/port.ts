/** The one localhost port the channel listens on and the extension dials — a
 * CONSTANT, not configuration: the shipped extension's manifest pins its host
 * permission to `http://localhost:8799/*` and the prebuilt bundle can't read an
 * env var, so a channel on any other port would simply be unreachable. Both
 * sides import this so the number can't drift. */
export const KVASIR_PORT = 8799;
