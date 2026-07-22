/**
 * Keep the old credential valid unless session revocation succeeds. This order
 * prevents a failed reset from changing the password without returning it.
 */
export async function revokeThenSetPassword(
  revokeSessions: () => Promise<unknown>,
  setPassword: () => Promise<unknown>,
): Promise<void> {
  await revokeSessions();
  await setPassword();
}
