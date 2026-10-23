/** Run inside the final image against disposable PostgreSQL and Redis. */
import server from "../dist/server/server.js";

const response = await server.fetch(new Request("http://localhost:3000/api/health"));
const result = await response.json();
if (
  response.status !== 200 ||
  !result.ok ||
  !["db", "controlDb", "redis", "pdf"].every((name) => result.checks?.[name] === true) ||
  response.headers.get("cache-control") !== "no-store"
) {
  console.error("Production image readiness failed", { status: response.status, result });
  process.exit(1);
}
console.log("Production image readiness passed: PostgreSQL, control database, Redis, PDF");
process.exit(0);
