import { auth, type Session } from "~/server/auth/auth";
import { ensureBootstrapAdmin } from "~/server/auth/bootstrap";
import { db, type DB } from "~/server/db/client";

export type AppContext = {
  db: DB;
  session: Session | null;
  headers: Headers;
  requestId: string;
};

export async function createContext(request: Request): Promise<AppContext> {
  await ensureBootstrapAdmin();
  const session = await auth().api.getSession({ headers: request.headers });
  return {
    db: db(),
    session: session ?? null,
    headers: request.headers,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}
