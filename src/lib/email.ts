import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { dataRoot } from "./data-root";
import { env } from "./env";

const MAX_FILE_NAME = 200;

/** Sends the sign-in link by Resend, or with EMAIL_TRANSPORT=file writes it to data/magic-links/<email>.txt and logs it. */
export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  if (env.EMAIL_TRANSPORT === "file") return writeLinkToFile(email, url);
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const resend = new Resend(env.RESEND_API_KEY);
  // Resend reports failures in the result instead of throwing.
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Your Resume Tailor sign-in link",
    text: `Click to sign in (valid for 5 minutes):\n\n${url}\n\nIf you did not ask for this, ignore this email.`,
  });
  if (error) throw new Error(`Resend could not send the sign-in email: ${error.message}`);
}

async function writeLinkToFile(email: string, url: string): Promise<void> {
  const dir = path.resolve(dataRoot(), "magic-links");
  // The address comes from the request body: never let it pick a path.
  const name = path.basename(email.toLowerCase()).slice(0, MAX_FILE_NAME);
  const file = path.resolve(dir, `${name}.txt`);
  if (path.dirname(file) !== dir) throw new Error("Refusing to write a magic link outside data/magic-links");
  await mkdir(dir, { recursive: true });
  await writeFile(file, url);
  console.log(`[email] magic link for ${email}: ${url}`);
}
