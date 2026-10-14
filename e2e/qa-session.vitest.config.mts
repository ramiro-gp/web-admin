import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("../src", import.meta.url)),
    "server-only": fileURLToPath(new URL("../tests/server-only.ts", import.meta.url)),
  } },
  test: { environment: "node", include: ["e2e/qa-session.setup.ts"], testTimeout: 60_000, maxWorkers: 1 },
});
