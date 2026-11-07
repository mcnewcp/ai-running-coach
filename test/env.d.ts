/// <reference types="vite/client" />
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** The Coaching Framework's documents by path, and every file path in the repo. */
      FRAMEWORK: { documents: Record<string, string>; paths: string[] };
    }
  }
}
