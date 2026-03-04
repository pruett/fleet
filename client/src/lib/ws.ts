import type {
  ParsedMessage,
  SessionStarted,
  SessionStopped,
  SessionError,
  SessionActivity,
  LifecycleEvent,
  GlobalActivityEvent,
} from "@fleet/shared";

// ============================================================
// Server → Client message types
// ============================================================

export interface MessageBatch {
  type: "messages";
  sessionId: string;
  messages: ParsedMessage[];
  byteRange: { start: number; end: number };
}

export interface WsError {
  type: "error";
  code: string;
  message: string;
}

export interface Heartbeat {
  type: "heartbeat";
}

export type ServerMessage = MessageBatch | LifecycleEvent | GlobalActivityEvent | WsError | Heartbeat;

// Re-export shared types used by consumers of this module
export type {
  LifecycleEvent,
  GlobalActivityEvent,
  SessionStarted,
  SessionStopped,
  SessionError,
  SessionActivity,
};

// ============================================================
// Connection status types
// ============================================================

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Reconnect attempt count (0 when connected or on initial connect). */
  attempt: number;
}

// ============================================================
// Event emitter types — supports multiple listeners per event
// ============================================================

export type WsEvents = {
  message: MessageBatch;
  lifecycle: LifecycleEvent;
  error: WsError;
  "global-activity": GlobalActivityEvent;
  "connection-change": ConnectionInfo;
  reconnect: undefined;
};

export type WsEventHandler<K extends keyof WsEvents> =
  WsEvents[K] extends undefined ? () => void : (data: WsEvents[K]) => void;

// ============================================================
// WsClient — WebSocket wrapper with auto-reconnection
// ============================================================

export interface WsClient {
  /** Subscribe to live updates for a session. */
  subscribe(sessionId: string): void;
  /** Unsubscribe from the current session. */
  unsubscribe(): void;

  /** Register an event listener. Multiple listeners per event are supported. */
  on<K extends keyof WsEvents>(event: K, handler: WsEventHandler<K>): void;
  /** Remove a previously registered event listener. */
  off<K extends keyof WsEvents>(event: K, handler: WsEventHandler<K>): void;

  /** Tear down the connection permanently (no reconnect). */
  destroy(): void;
}

/**
 * Create a WebSocket client that connects to the server's `/ws` endpoint.
 *
 * The connection is opened immediately. On unexpected disconnection the client
 * automatically reconnects using exponential backoff (base 1s, max 30s, random
 * jitter 0–500ms). On reconnect the active subscription is restored and the
 * `reconnect` event is emitted so consumers can re-fetch baseline data.
 *
 * Typically you don't call this directly — use `<WsProvider>` and `useWsClient()`
 * to share a single connection across the component tree.
 */
export function createWsClient(): WsClient {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;

  let ws: WebSocket | null = null;
  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentSubscriptionId: string | null = null;
  let hasConnectedOnce = false;

  // Queue commands sent before the socket is open or while reconnecting.
  // Tagged so we can distinguish subscribe/unsubscribe from other payloads.
  interface QueuedCommand {
    data: string;
    /** If true, this is a subscribe/unsubscribe that the auto-reconnect will
     *  re-issue — safe to discard on reconnect. */
    isSubscription: boolean;
  }
  const pendingQueue: QueuedCommand[] = [];

  // ---------------------------------------------------------------------------
  // Event listener registry
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Map<keyof WsEvents, Set<(...args: any[]) => void>>();

  function getListeners<K extends keyof WsEvents>(event: K): Set<WsEventHandler<K>> {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    return set as Set<WsEventHandler<K>>;
  }

  function emit<K extends keyof WsEvents>(
    event: K,
    ...args: WsEvents[K] extends undefined ? [] : [WsEvents[K]]
  ): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[ws] Error in "${event}" handler:`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Transport helpers
  // ---------------------------------------------------------------------------

  function send(data: string, isSubscription = false): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      // Queue on ANY non-OPEN state (CONNECTING, CLOSING, CLOSED) so
      // subscribe/unsubscribe commands are never silently dropped.
      pendingQueue.push({ data, isSubscription });
    }
  }

  /** Compute reconnect delay: min(1000 * 2^attempt, 30000) + jitter(0–500). */
  function getReconnectDelay(attempt: number): number {
    const base = 1000;
    const max = 30000;
    const exponential = Math.min(base * Math.pow(2, attempt), max);
    const jitter = Math.random() * 500;
    return exponential + jitter;
  }

  function scheduleReconnect(): void {
    const delay = getReconnectDelay(reconnectAttempt);
    reconnectAttempt++;
    emit("connection-change", {
      status: "reconnecting",
      attempt: reconnectAttempt,
    });
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    if (intentionalClose) return;

    // Only discard subscription commands from the queue — the reconnect
    // handler will re-subscribe automatically using currentSubscriptionId.
    // Preserve any non-subscription commands so they aren't silently lost.
    const preserved = pendingQueue.filter((cmd) => !cmd.isSubscription);
    pendingQueue.length = 0;
    pendingQueue.push(...preserved);

    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      const isReconnect = hasConnectedOnce;
      hasConnectedOnce = true;
      reconnectAttempt = 0;
      reconnectTimer = null;
      emit("connection-change", { status: "connected", attempt: 0 });

      // Flush any commands queued while connecting. Filter out subscription
      // commands here as well — the auto-re-subscribe below uses the latest
      // currentSubscriptionId, so stale subscribe/unsubscribe from the queue
      // (e.g. if the user navigated sessions during reconnect) must be dropped.
      const toFlush = pendingQueue.filter((cmd) => !cmd.isSubscription);
      pendingQueue.length = 0;
      for (const cmd of toFlush) {
        ws!.send(cmd.data);
      }

      if (isReconnect) {
        // Re-subscribe to the active session (uses latest sessionId)
        if (currentSubscriptionId) {
          ws!.send(
            JSON.stringify({
              type: "subscribe",
              sessionId: currentSubscriptionId,
            }),
          );
        }
        emit("reconnect");
      } else if (currentSubscriptionId) {
        // Initial connect: send the subscription that was queued while CONNECTING
        ws!.send(
          JSON.stringify({
            type: "subscribe",
            sessionId: currentSubscriptionId,
          }),
        );
      }
    });

    ws.addEventListener("close", () => {
      if (!intentionalClose) {
        scheduleReconnect();
      } else {
        emit("connection-change", { status: "disconnected", attempt: 0 });
      }
    });

    ws.addEventListener("error", () => {
      // The browser fires 'error' before 'close'; reconnection
      // will be handled by the close handler.
    });

    ws.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        console.warn("[ws] Malformed WebSocket message, discarding:", event.data);
        return;
      }

      switch (msg.type) {
        case "messages":
          emit("message", msg);
          break;
        case "session:started":
        case "session:stopped":
        case "session:error":
        case "session:activity":
          emit("lifecycle", msg as LifecycleEvent);
          break;
        case "global:activity":
          emit("global-activity", msg as GlobalActivityEvent);
          break;
        case "error":
          emit("error", msg);
          break;
        case "heartbeat":
          // Respond to server heartbeat with a pong for bidirectional liveness.
          // Only send on OPEN — pongs are meaningless after reconnect.
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
        default:
          break;
      }
    });
  }

  const client: WsClient = {
    subscribe(sessionId: string) {
      currentSubscriptionId = sessionId;
      send(JSON.stringify({ type: "subscribe", sessionId }), true);
    },

    unsubscribe() {
      currentSubscriptionId = null;
      send(JSON.stringify({ type: "unsubscribe" }), true);
    },

    on<K extends keyof WsEvents>(event: K, handler: WsEventHandler<K>) {
      getListeners(event).add(handler);
    },

    off<K extends keyof WsEvents>(event: K, handler: WsEventHandler<K>) {
      getListeners(event).delete(handler);
    },

    destroy() {
      intentionalClose = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      listeners.clear();
      ws?.close();
    },
  };

  // Start the initial connection
  connect();

  return client;
}
