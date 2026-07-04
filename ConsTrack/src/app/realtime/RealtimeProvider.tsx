import { createContext, useCallback, useEffect, useRef } from "react";
import { useProject } from "../project/useProject";

type Callback = (msg: any) => void;

export type RealtimeContextValue = {
  subscribe: (eventType: string, callback: Callback) => () => void;
};

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { activeProjectId } = useProject();

  // Map from eventType → set of callbacks
  const listenersRef = useRef<Map<string, Set<Callback>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

useEffect(() => {
    if (!activeProjectId) return;

    try { wsRef.current?.close(); } catch { /* ignore */ }

    //Read from Vite env, fallback to localhost
    const baseUrl = import.meta.env.VITE_API_BASE || "http://localhost:4000";
    
    //Safely swap http -> ws and https -> wss
    const wsBase = baseUrl.replace(/^http/, "ws");
    const wsUrl = `${wsBase}/ws?projectId=${encodeURIComponent(activeProjectId)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        const type: string = msg?.type;
        if (!type) return;
        const handlers = listenersRef.current.get(type);
        if (handlers) {
          for (const cb of handlers) cb(msg);
        }
      } catch { /* ignore malformed messages */ }
    };

    return () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }, [activeProjectId]);

  const subscribe = useCallback((eventType: string, callback: Callback): (() => void) => {
    const map = listenersRef.current;
    if (!map.has(eventType)) map.set(eventType, new Set());
    map.get(eventType)!.add(callback);
    return () => map.get(eventType)?.delete(callback);
  }, []);

  return (
    <RealtimeContext.Provider value={{ subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
}
