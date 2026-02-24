import type { ParsedMessage } from "@/types/api";

// ============================================================
// Server → Client message types
// ============================================================

export interface MessageBatch {
  type: "messages";
  sessionId: string;
  messages: ParsedMessage[];
  byteRange: { start: number; end: number };
}

export interface SessionStartedEvent {
  type: "session:started";
  sessionId: string;
  projectId: string;
  cwd: string;
  startedAt: string;
}

export interface SessionStoppedEvent {
  type: "session:stopped";
  sessionId: string;
  reason: "user" | "completed";
  stoppedAt: string;
}

export interface SessionErrorEvent {
  type: "session:error";
  sessionId: string;
  error: string;
  occurredAt: string;
}

export interface WsError {
  type: "error";
  code: string;
  message: string;
}

export type LifecycleEvent =
  | SessionStartedEvent
  | SessionStoppedEvent
  | SessionErrorEvent;

export type ServerMessage = MessageBatch | LifecycleEvent | WsError;

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
// WsClient — WebSocket wrapper with auto-reconnection
// ============================================================

export interface WsClient {
  /** Subscribe to live updates for a session. */
  subscribe(sessionId: string): void;
  /** Unsubscribe from the current session. */
  unsubscribe(): void;
  /** Close the WebSocket connection permanently (no reconnect). */
  close(): void;

  // --- Callbacks (assign before or after connecting) ---

  /** Called when a batch of new messages arrives for the subscribed session. */
  onMessage: ((batch: MessageBatch) => void) | null;
  /** Called for session lifecycle events (started/stopped/error). */
  onLifecycleEvent: ((event: LifecycleEvent) => void) | null;
  /** Called when the server sends an error frame. */
  onError: ((error: WsError) => void) | null;
  /** Called when the connection status changes. */
  onConnectionChange: ((info: ConnectionInfo) => void) | null;
  /** Called after a successful reconnect (not on initial connect). */
  onReconnect: (() => void) | null;
}

/**
 * Create a WebSocket client that connects to the server's `/ws` endpoint.
 *
 * The connection is opened immediately. On unexpected disconnection the client
 * automatically reconnects using exponential backoff (base 1s, max 30s, random
 * jitter 0–500ms). On reconnect the active subscription is restored and the
 * `onReconnect` callback is fired so the consumer can re-fetch baseline data.
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

  // Queue commands sent before the socket is open
  const pendingQueue: string[] = [];

  const client: WsClient = {
    onMessage: null,
    onLifecycleEvent: null,
    onError: null,
    onConnectionChange: null,
    onReconnect: null,

    subscribe(sessionId: string) {
      currentSubscriptionId = sessionId;
      send(JSON.stringify({ type: "subscribe", sessionId }));
    },

    unsubscribe() {
      currentSubscriptionId = null;
      send(JSON.stringify({ type: "unsubscribe" }));
    },

    close() {
      intentionalClose = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
    },
  };

  function send(data: string): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else if (ws?.readyState === WebSocket.CONNECTING) {
      pendingQueue.push(data);
    }
    // CLOSING / CLOSED — silently drop
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
    client.onConnectionChange?.({
      status: "reconnecting",
      attempt: reconnectAttempt,
    });
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    if (intentionalClose) return;

    // Clear any commands queued from a previous connection attempt to avoid
    // sending stale/duplicate subscribes alongside the automatic re-subscribe.
    pendingQueue.length = 0;

    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      const isReconnect = hasConnectedOnce;
      hasConnectedOnce = true;
      reconnectAttempt = 0;
      reconnectTimer = null;
      client.onConnectionChange?.({ status: "connected", attempt: 0 });

      // Flush any commands queued while connecting
      for (const data of pendingQueue) {
        ws!.send(data);
      }
      pendingQueue.length = 0;

      if (isReconnect) {
        // Re-subscribe to the active session
        if (currentSubscriptionId) {
          ws!.send(
            JSON.stringify({
              type: "subscribe",
              sessionId: currentSubscriptionId,
            }),
          );
        }
        client.onReconnect?.();
      }
    });

    ws.addEventListener("close", () => {
      if (!intentionalClose) {
        scheduleReconnect();
      } else {
        client.onConnectionChange?.({ status: "disconnected", attempt: 0 });
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
        // Malformed frame — log and discard, do not crash
        console.warn("[ws] Malformed WebSocket message, discarding:", event.data);
        return;
      }

      switch (msg.type) {
        case "messages":
          client.onMessage?.(msg);
          break;
        case "session:started":
        case "session:stopped":
        case "session:error":
          client.onLifecycleEvent?.(msg);
          break;
        case "error":
          client.onError?.(msg);
          break;
        default:
          // Unknown message type — ignore
          break;
      }
    });
  }

  // Start the initial connection
  connect();

  return client;
}
