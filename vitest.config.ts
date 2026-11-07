import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Synthetic sign-in settings; test/oauth.test.ts fakes GitHub.
            ALLOWED_GITHUB_USERS: "synthetic-runner, second-runner",
            GITHUB_CLIENT_ID: "synthetic-github-client",
            GITHUB_CLIENT_SECRET: "synthetic-github-secret",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
