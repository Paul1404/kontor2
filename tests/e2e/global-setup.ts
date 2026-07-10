import { chromium } from "@playwright/test";
import { E2E_BASE_URL, ensureAdmin } from "./fixtures";

/**
 * Runs once before the whole suite: make sure the first admin exists (via the
 * `/setup` route, which is only reachable while the users table is empty). Each
 * test then signs in through the form itself and creates whatever data it
 * needs, so no other seeding is required here.
 */
export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: E2E_BASE_URL });
    await ensureAdmin(page);
  } finally {
    await browser.close();
  }
}
