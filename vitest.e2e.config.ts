import { defineConfig } from "vitest/config";

// The end-to-end run against the real API in Test mode (see test/e2e/shipping.test.ts).
export default defineConfig({ test: { include: ["test/e2e/**/*.test.ts"], testTimeout: 60_000 } });
