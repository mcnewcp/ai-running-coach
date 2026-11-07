/// <reference types="vite/client" />
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** A second bucket, standing in for the remote one the import copies the vault to. */
      REMOTE_DOCUMENTS: R2Bucket;
    }
  }
}
