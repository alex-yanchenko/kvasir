import { connect } from "node:net";
import { KVASIR_PORT } from "../packages/runes/src/port";

const acceptsConnections = (host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port: KVASIR_PORT });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });

export async function assertKvasirPortFree(): Promise<void> {
  const listeners = await Promise.all(["127.0.0.1", "::1"].map((host) => acceptsConnections(host)));
  if (listeners.some(Boolean)) {
    throw new Error(
      `Port ${KVASIR_PORT} is in use, probably by a running Kvasir channel. ` +
        `The extension only talks to localhost:${KVASIR_PORT}, so the screenshot run needs it free ` +
        `for its stand-in server. Stop the channel (or wait for it to exit) and run pnpm screenshots again.`,
    );
  }
}
