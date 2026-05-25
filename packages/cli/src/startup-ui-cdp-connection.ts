export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly handlers = new Map<string, ((event: CdpEvent) => void)[]>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Chrome DevTools websocket closed"));
      }

      this.pending.clear();
    });
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolveConnection, reject) => {
      const socket = new WebSocket(url);
      const onOpen = () => {
        cleanup();
        resolveConnection(new CdpConnection(socket));
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to connect to Chrome DevTools websocket"));
      };
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
  }

  command(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload = {
      id,
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId })
    };

    return new Promise((resolveCommand, reject) => {
      this.pending.set(id, { resolve: resolveCommand, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  onSessionEvent(
    sessionId: string,
    method: string,
    handler: (event: CdpEvent) => void
  ): void {
    const key = `${sessionId}:${method}`;
    const handlers = this.handlers.get(key) ?? [];

    handlers.push(handler);
    this.handlers.set(key, handlers);
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(data: unknown): void {
    const message = JSON.parse(String(data)) as CdpMessage;

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);

      if (pending === undefined) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (message.method !== undefined && message.sessionId !== undefined) {
      const handlers =
        this.handlers.get(`${message.sessionId}:${message.method}`) ?? [];

      for (const handler of handlers) {
        handler(message as CdpEvent);
      }
    }
  }
}

interface CdpMessage {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    message: string;
  };
}

interface CdpEvent extends CdpMessage {
  sessionId: string;
  method: string;
}
