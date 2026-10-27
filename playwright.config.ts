import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3123;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, headless: true },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: { RESUME_DATA_DIR: path.resolve(".e2e-data") },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
