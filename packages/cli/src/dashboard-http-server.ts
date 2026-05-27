import type { Server } from "node:http";

export function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolveListen();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function serverPort(server: Server): number {
  const address = server.address();

  if (typeof address === "object" && address !== null) {
    return address.port;
  }

  throw new Error("Dashboard server did not expose a TCP port");
}

export function urlHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }

  return host.includes(":") ? `[${host}]` : host;
}
