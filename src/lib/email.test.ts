import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { sendMagicLinkEmail } from "./email";

const env = vi.hoisted(() => ({}) as Partial<Env>);
vi.mock("./env", () => ({ env }));

const URL = "http://localhost:3000/api/auth/magic-link/verify?token=abc";

describe("sendMagicLinkEmail", () => {
  let dataDir: string;
  const linksDir = () => path.join(dataDir, "magic-links");

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "resume-email-"));
    vi.stubEnv("RESUME_DATA_DIR", dataDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    Object.assign(env, { EMAIL_TRANSPORT: "file", RESEND_API_KEY: undefined });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes the link to data/magic-links/<lowercased email>.txt with the file transport", async () => {
    await sendMagicLinkEmail("Ada@Example.com", URL);
    expect(readFileSync(path.join(linksDir(), "ada@example.com.txt"), "utf8")).toBe(URL);
  });

  it("keeps the file inside data/magic-links whatever the address contains", async () => {
    await sendMagicLinkEmail("../../escape@example.com", URL);
    expect(readdirSync(linksDir())).toEqual(["escape@example.com.txt"]);
  });

  it("caps the file name at 200 characters", async () => {
    await sendMagicLinkEmail(`${"a".repeat(300)}@example.com`, URL);
    expect(readdirSync(linksDir())).toEqual([`${"a".repeat(200)}.txt`]);
  });

  it("refuses the Resend transport without an API key", async () => {
    env.EMAIL_TRANSPORT = "resend";
    await expect(sendMagicLinkEmail("ada@example.com", URL)).rejects.toThrow("RESEND_API_KEY is not set");
  });
});
