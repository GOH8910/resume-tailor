import path from "node:path";
import { defineConfig, type PlaywrightTestConfig, type PlaywrightTestProject } from "@playwright/test";

type ServerSpec = { name: string; port: number; env: Record<string, string> };
type WebServer = Extract<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]>[number];

// One dev server per project, each with its own port, data folder and Next build folder (Next allows one `next dev`
// per build folder), so both projects run in one `npm run test:e2e`.
const SERVERS: ServerSpec[] = [
  { name: "selfhost", port: 3123, env: { APP_MODE: "selfhost" } },
  {
    name: "hosted",
    port: 3124,
    env: {
      APP_MODE: "hosted",
      AD_PROVIDER: "test",
      AD_MIN_WATCH_SECONDS: "1",
      AD_SSV_ENABLED: "",
      CREDITS_PER_TAILOR: "2",
      SIGNUP_GRANT_CREDITS: "0",
      ADMIN_EMAILS: "",
      // Set but empty, so a key in .env.local can never reach Claude from a test: tailoring answers 503.
      ANTHROPIC_API_KEY: "",
    },
  },
];

const baseUrl = (spec: ServerSpec) => `http://localhost:${spec.port}`;
const dataDir = (spec: ServerSpec) => path.resolve(".e2e-data", spec.name);

function webServer(spec: ServerSpec): WebServer {
  return {
    name: spec.name,
    // The data folder is emptied here, not in a test hook: the server opens its PGlite database there as it boots.
    command: `rm -rf .e2e-data/${spec.name} && npm run dev -- --port ${spec.port}`,
    url: baseUrl(spec),
    env: {
      NEXT_DIST_DIR: `.next-e2e/${spec.name}`,
      RESUME_DATA_DIR: dataDir(spec),
      // Sign-in links are absolute URLs built from this; "file" writes them to <data>/magic-links/<email>.txt.
      BETTER_AUTH_URL: baseUrl(spec),
      EMAIL_TRANSPORT: "file",
      // Set but empty, so a value in .env.local cannot point the tests at a real database or close sign-ups.
      DATABASE_URL: "",
      SIGNUP_EMAILS: "",
      ...spec.env,
    },
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  };
}

const HOSTED_ONLY = /credits\.spec\.ts$/;

function project(spec: ServerSpec): PlaywrightTestProject {
  return {
    name: spec.name,
    ...(spec.name === "hosted" ? { testMatch: HOSTED_ONLY } : { testIgnore: HOSTED_ONLY }),
    use: { baseURL: baseUrl(spec), headless: true },
    // e2e/helpers.ts reads the sign-in links from here.
    metadata: { dataDir: dataDir(spec) },
  };
}

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  projects: SERVERS.map(project),
  webServer: SERVERS.map(webServer),
});
