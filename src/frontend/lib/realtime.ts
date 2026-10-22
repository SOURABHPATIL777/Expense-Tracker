import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import type { RealtimeTokenDto } from "@/shared/schemas/auth";

/** The fields of an `imports` row a change notification carries (the full data still comes from the API). */
export type ImportChange = { id: string; status: string; file_name: string };
export type RealtimeStatus = "connecting" | "live" | "offline";

type Listener = (change: ImportChange) => void;
type StatusListener = (status: RealtimeStatus) => void;

/** Renew the socket's token this long before it expires. */
const REFRESH_EARLY_MS = 60_000;
const RECONNECT_MS = 15_000;

/**
 * One Supabase Realtime connection per tab, shared by every component that wants to know when the
 * user's imports change (progress, completion). It opens with the first listener and closes with
 * the last. Row-level security on `imports` decides what this user may hear about.
 */
class ImportEvents {
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: RealtimeStatus = "offline";
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  subscribe(listener: Listener, onStatus: StatusListener): () => void {
    this.listeners.add(listener);
    this.statusListeners.add(onStatus);
    onStatus(this.status);
    if (this.listeners.size === 1) void this.connect();
    return () => {
      this.listeners.delete(listener);
      this.statusListeners.delete(onStatus);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  private setStatus(status: RealtimeStatus) {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private async connect() {
    const generation = ++this.generation;
    this.setStatus("connecting");
    try {
      const { data: token } = await api.get<RealtimeTokenDto>(API_ROUTES.auth.realtime);
      if (generation !== this.generation) return;
      this.client ??= createClient(token.url, token.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      await this.client.realtime.setAuth(token.accessToken);
      this.channel = this.client
        .channel(`imports:${token.userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "imports", filter: `user_id=eq.${token.userId}` }, (payload) => {
          const row = (payload.new && "id" in payload.new ? payload.new : payload.old) as ImportChange;
          for (const l of this.listeners) l(row);
        })
        .subscribe((state) => {
          if (generation !== this.generation) return;
          if (state === "SUBSCRIBED") this.setStatus("live");
          else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") this.retryLater();
        });
      this.schedule(() => this.refreshToken(generation), Math.max(10_000, token.expiresAt - Date.now() - REFRESH_EARLY_MS));
    } catch {
      if (generation === this.generation) this.retryLater();
    }
  }

  private async refreshToken(generation: number) {
    try {
      const { data: token } = await api.get<RealtimeTokenDto>(API_ROUTES.auth.realtime);
      if (generation !== this.generation || !this.client) return;
      await this.client.realtime.setAuth(token.accessToken);
      this.schedule(() => this.refreshToken(generation), Math.max(10_000, token.expiresAt - Date.now() - REFRESH_EARLY_MS));
    } catch {
      if (generation === this.generation) this.retryLater();
    }
  }

  private retryLater() {
    this.setStatus("offline");
    this.teardownChannel();
    this.schedule(() => void this.connect(), RECONNECT_MS);
  }

  private schedule(fn: () => void, ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  private teardownChannel() {
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
  }

  private disconnect() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.teardownChannel();
    this.setStatus("offline");
  }
}

export const importEvents = new ImportEvents();
