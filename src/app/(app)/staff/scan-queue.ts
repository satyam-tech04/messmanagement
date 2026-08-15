/**
 * Offline scan queue (§6.4).
 *
 * Counter Wi-Fi drops. When it does, the scan is buffered locally and replayed
 * on reconnect rather than lost — the student has already walked away with
 * their food, so the attendance row must eventually exist.
 *
 * Replay is safe because the server is idempotent: the
 * `UNIQUE (tenant_id, student_id, service_date, meal_slot)` constraint means a
 * replayed scan produces `ALREADY_SERVED` and zero additional rows. That is a
 * *success* from the queue's point of view — the record exists, which is all it
 * was trying to achieve.
 *
 * `localStorage` rather than IndexedDB deliberately: the payloads are tiny, the
 * queue is short-lived, and a synchronous API cannot lose a write when the tab
 * is closed mid-transaction.
 */

const STORAGE_KEY = "messos.scanQueue.v1";

/**
 * Beyond this the meal is over and replaying would write the wrong service
 * date, so a stale entry must not be synced.
 *
 * It must not be *discarded* either. These are students who already walked away
 * with their food; a tablet left offline overnight would otherwise erase a
 * whole service with nobody ever knowing. Stale entries are held back from sync
 * and surfaced to staff instead — see `expiredScans`.
 */
export const MAX_QUEUE_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export interface QueuedScan {
  /** Client-generated, so a retry of the same buffered scan is recognisable. */
  readonly id: string;
  readonly queuedAt: number;
  readonly body: Record<string, unknown>;
}

function read(): QueuedScan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedScan[]) : [];
  } catch {
    // Corrupt storage must not brick the scanner mid-service.
    return [];
  }
}

function write(entries: QueuedScan[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Quota exceeded or private mode. Losing the buffer is bad, but throwing
    // here would take the whole scanner down mid-queue.
  }
}

/** Entries still young enough to sync. */
export function queuedScans(): QueuedScan[] {
  const now = Date.now();
  return read().filter((entry) => now - entry.queuedAt < MAX_QUEUE_AGE_MS);
}

/**
 * Entries too old to sync safely.
 *
 * Each one is a meal that was served and never recorded. They are kept until
 * someone acknowledges them, so the loss is visible rather than silent.
 */
export function expiredScans(): QueuedScan[] {
  const now = Date.now();
  return read().filter((entry) => now - entry.queuedAt >= MAX_QUEUE_AGE_MS);
}

/** Forgets stale entries, once staff have seen them. */
export function clearExpiredScans(): void {
  write(queuedScans());
}

export function enqueueScan(body: Record<string, unknown>): QueuedScan {
  const entry: QueuedScan = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    queuedAt: Date.now(),
    body,
  };
  write([...read(), entry]);
  return entry;
}

export function dequeueScan(id: string): void {
  write(read().filter((entry) => entry.id !== id));
}

export interface FlushResult {
  readonly synced: number;
  readonly failed: number;
}

/**
 * Replays everything buffered.
 *
 * A queued scan is removed when the server *answers* — including when it
 * answers `ALREADY_SERVED`, because that means the attendance row exists and
 * there is nothing left to sync. Only a transport failure keeps an entry
 * queued, so a legitimate denial cannot loop forever.
 */
export async function flushScanQueue(): Promise<FlushResult> {
  let synced = 0;
  let failed = 0;

  for (const entry of queuedScans()) {
    try {
      const response = await fetch("/api/qr/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
      });

      if (response.ok) {
        dequeueScan(entry.id);
        synced++;
      } else if (response.status >= 400 && response.status < 500) {
        // The server understood and refused — a 401/403/400 will refuse
        // identically forever. Drop it rather than retry to exhaustion.
        dequeueScan(entry.id);
        failed++;
      } else {
        failed++;
      }
    } catch {
      // Still offline. Keep it for the next attempt.
      failed++;
    }
  }

  return { synced, failed };
}
