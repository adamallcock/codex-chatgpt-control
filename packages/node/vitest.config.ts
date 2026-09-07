import process from "node:process";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Avoid overlapping real-fsync suites on hosted Windows filesystems.
    // Explicit concurrent operations within individual tests still run.
    fileParallelism: process.platform !== "win32",
    // Transactional journal/service tests intentionally exercise real fsync
    // and subprocess boundaries. Hosted CI filesystems can exceed Vitest's
    // generic five-second default without violating any production deadline.
    testTimeout: 15_000
  }
});
