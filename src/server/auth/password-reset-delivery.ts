import { AsyncLocalStorage } from "node:async_hooks";

export type PasswordResetDelivery = { ok: true } | { ok: false; reason: string };

type DeliveryContext = { result: PasswordResetDelivery | null };

const deliveryStore = new AsyncLocalStorage<DeliveryContext>();

/**
 * Observe the delivery result of one admin-triggered reset request. Public
 * password-reset requests intentionally run without this context so SMTP
 * failures remain indistinguishable from unknown email addresses.
 */
export async function observePasswordResetDelivery<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; delivery: PasswordResetDelivery | null }> {
  const state: DeliveryContext = { result: null };
  const value = await deliveryStore.run(state, fn);
  return { value, delivery: state.result };
}

export function recordPasswordResetDelivery(result: PasswordResetDelivery): void {
  const state = deliveryStore.getStore();
  if (state) state.result = result;
}
