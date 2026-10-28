import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3123;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: BASE_URL, headless: true },
  webServer: {
    // The data folder is emptied here, not in a test hook: the server opens its PGlite database there as it boots.
    command: `rm -rf .e2e-data && npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    env: {
      RESUME_DATA_DIR: path.resolve(".e2e-data"),
      // Sign-in links are absolute URLs built from this; "file" writes them to .e2e-data/magic-links/<email>.txt.
      BETTER_AUTH_URL: BASE_URL,
      EMAIL_TRANSPORT: "file",
      // Set but empty, so a value in .env.local cannot point the tests at a real database or close sign-ups.
      DATABASE_URL: "",
      SIGNUP_EMAILS: "",
    },
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
