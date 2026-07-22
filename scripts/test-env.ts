/** Shared environment for disposable integration and browser-test instances. */
export function createTestEnv(baseUrl = "http://localhost:3000"): Record<string, string> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://svuwv@localhost:5433/svuwv_test",
    REDIS_URL: "redis://localhost:6380",
    BETTER_AUTH_URL: baseUrl,
    APP_SECRET: "0".repeat(64),
    AWS_ENDPOINT_URL: "http://localhost:9000",
    AWS_S3_BUCKET_NAME: "svuwv-test",
    AWS_DEFAULT_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    SNAPSHOT_CRON_DISABLED: "1",
  };
}
