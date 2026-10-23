/** The persistent Docker development stack, separate from host and test databases. */
export function createDevEnv(inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const port = inherited.PORT ?? "3000";
  return {
    ...inherited,
    NODE_ENV: "development",
    PORT: port,
    DATABASE_URL: "postgres://kontor2:kontor2@127.0.0.1:5434/kontor2_dev",
    CONTROL_DATABASE_URL: "postgres://kontor2:kontor2@127.0.0.1:5434/kontor2_dev",
    TENANTS_JSON: "",
    PRIMARY_TENANT_KEY: "svu",
    REDIS_URL: "redis://127.0.0.1:6379",
    BETTER_AUTH_URL: `http://localhost:${port}`,
    AWS_ENDPOINT_URL: "http://127.0.0.1:9000",
    AWS_S3_BUCKET_NAME: "kontor2-dev",
    AWS_DEFAULT_REGION: "eu-central-1",
    AWS_ACCESS_KEY_ID: "minioadmin",
    AWS_SECRET_ACCESS_KEY: "minioadmin",
    SNAPSHOT_CRON_DISABLED: "1",
  };
}
