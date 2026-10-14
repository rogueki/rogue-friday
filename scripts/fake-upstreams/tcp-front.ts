import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";

/**
 * Plain TCP front for one backend listener. The fakes of the adapter packages listen on ephemeral ports; the front
 * owns the fixed, installer-style port (43691..43694) and can close and reopen it. A closed front behaves exactly like
 * the real service being stopped (ECONNREFUSED), and WebSocket upgrades pass through untouched.
 */
export class TcpFront {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private boundPort: number;

  constructor(
    readonly name: string,
    private readonly host: string,
    wantedPort: number,
    private readonly backendPort: () => number,
  ) {
    this.boundPort = wantedPort;
  }

  get port(): number {
    return this.boundPort;
  }

  get running(): boolean {
    return this.server !== undefined;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((client) => {
      this.sockets.add(client);
      const upstream = connect({ host: "127.0.0.1", port: this.backendPort() });
      this.sockets.add(upstream);
      const drop = (): void => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on("error", drop);
      upstream.on("error", drop);
      client.on("close", drop);
      upstream.on("close", drop);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.boundPort, this.host, () => {
        server.off("error", reject);
        this.boundPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
