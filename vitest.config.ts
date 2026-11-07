import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Stands in for the remote bucket in test/import-documents.test.ts.
          r2Buckets: ["REMOTE_DOCUMENTS"],
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
      // Agent worktrees live under .claude/worktrees; their tests aren't ours.
      exclude: [...configDefaults.exclude, ".claude/**"],
    },
  };
});
