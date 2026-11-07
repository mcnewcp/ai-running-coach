import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { readdirSync, readFileSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The Coaching Framework's documents (CLAUDE.md and resources/), and every
 * file path in the repo for checking their links. The tests run in the
 * Workers runtime, which can't read the repo, so they get these as a binding.
 */
function readFramework() {
  const ignored = new Set(["node_modules", ".git", ".claude", ".wrangler"]);
  const paths = readdirSync(".", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`.replace(/^\.\//, ""))
    .filter((path) => !ignored.has(path.split("/")[0]!));
  const documents = Object.fromEntries(
    paths
      .filter((path) => path === "CLAUDE.md" || (path.startsWith("resources/") && path.endsWith(".md")))
      .map((path) => [path, readFileSync(path, "utf8")]),
  );
  return { documents, paths };
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            FRAMEWORK: readFramework(),
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
