/**
 * Port resolution for concurrent dev servers.
 *
 * Starting at port 3000, pick the first free port for the Fleet server
 * and the next free port after that for the Vite client.
 */

import { createServer } from "node:net";

const DEFAULT_START_PORT = 3000;
const MAX_PORT = 65_535;

export interface ResolvedPorts {
  server: number;
  client: number;
}

export type PortAvailabilityChecker = (port: number) => Promise<boolean>;

function assertPort(port: number) {
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new RangeError(
      `Port must be an integer between 0 and ${MAX_PORT}: ${port}`,
    );
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(true);
      });
    });

    try {
      server.listen(port);
    } catch (error) {
      reject(error);
    }
  });
}

export async function findAvailablePort(
  startPort: number,
  isAvailable: PortAvailabilityChecker = isPortAvailable,
): Promise<number> {
  assertPort(startPort);

  for (let port = startPort; port <= MAX_PORT; port += 1) {
    if (await isAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available ports found starting at ${startPort}`);
}

export async function resolvePorts(
  startPort = DEFAULT_START_PORT,
  isAvailable: PortAvailabilityChecker = isPortAvailable,
): Promise<ResolvedPorts> {
  const server = await findAvailablePort(startPort, isAvailable);
  const client = await findAvailablePort(server + 1, isAvailable);

  return { server, client };
}
