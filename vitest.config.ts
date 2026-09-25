import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Synthetic settings. Tests never use real Athlete Record data, including a
// developer's own .dev.vars.
const settings = { ATHLETE_TIMEZONE: "America/New_York" };

// Wrangler checks required secrets before the bindings below override them,
// and warns without this when there's no .dev.vars (as in CI).
Object.assign(process.env, settings);

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { ...settings, TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
