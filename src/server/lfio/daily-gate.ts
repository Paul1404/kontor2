const DEFAULT_TTL_SECONDS = 48 * 60 * 60;

export type DailyGateStore = {
  reserve(key: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
};

export type DailyGateResult<T> =
  | { status: "fresh"; value: T }
  | { status: "cached"; value: T | null }
  | { status: "gate_error"; error: string }
  | { status: "collect_error"; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Run a potentially billable collector at most once per UTC day across all
 * replicas. The reservation is written before collection, so a failed or timed
 * out collection is not retried every minute. If the persistent gate cannot be
 * read or written, collection fails closed.
 */
export async function runPersistedDailyGate<T>(opts: {
  namespace: string;
  store: DailyGateStore;
  collect: () => Promise<T>;
  now?: Date;
  ttlSeconds?: number;
}): Promise<DailyGateResult<T>> {
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const day = utcDay(opts.now ?? new Date());
  const markerKey = `${opts.namespace}:gate:${day}`;
  const resultKey = `${opts.namespace}:result`;

  let reserved: boolean;
  try {
    reserved = await opts.store.reserve(markerKey, ttlSeconds);
  } catch (error) {
    return { status: "gate_error", error: errorMessage(error) };
  }

  if (!reserved) {
    try {
      const cached = await opts.store.get(resultKey);
      return { status: "cached", value: cached === null ? null : (JSON.parse(cached) as T) };
    } catch (error) {
      return { status: "gate_error", error: errorMessage(error) };
    }
  }

  try {
    const value = await opts.collect();
    await opts.store.put(resultKey, JSON.stringify(value), ttlSeconds);
    return { status: "fresh", value };
  } catch (error) {
    // Deliberately keep the daily reservation. Retrying a billable collector on
    // every one-minute telemetry tick would turn an outage into a cost loop.
    return { status: "collect_error", error: errorMessage(error) };
  }
}
