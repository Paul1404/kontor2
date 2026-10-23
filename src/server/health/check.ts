/** Evaluate every probe on each call. Concurrent requests share one run. */
export function createHealthcheck(
  probes: Record<string, () => Promise<boolean>>,
  timeoutMs = 5_000,
) {
  let pending: Promise<{ ok: boolean; checks: Record<string, boolean> }> | undefined;
  return () => {
    pending ??= Promise.all(
      Object.entries(probes).map(async ([name, probe]) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const ok = await Promise.race([
            Promise.resolve().then(probe),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), timeoutMs);
            }),
          ]);
          return [name, ok] as const;
        } catch {
          return [name, false] as const;
        } finally {
          clearTimeout(timer);
        }
      }),
    )
      .then((results) => ({
        ok: results.every(([, ok]) => ok),
        checks: Object.fromEntries(results),
      }))
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
