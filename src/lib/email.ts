import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { dataRoot } from "./data-root";
import { env } from "./env";

/** Sends the sign-in link; without a Resend key it is written to data/magic-links/<email>.txt and logged. */
export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  if (env.RESEND_API_KEY) {
    const resend = new Resend(env.RESEND_API_KEY);
    // Resend reports failures in the result instead of throwing.
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: email,
      subject: "Your Resume Tailor sign-in link",
      text: `Click to sign in (valid for 5 minutes):\n\n${url}\n\nIf you did not ask for this, ignore this email.`,
    });
    if (error) throw new Error(`Resend could not send the sign-in email: ${error.message}`);
    return;
  }
  if (env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
  const dir = path.join(dataRoot(), "magic-links");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${email.toLowerCase()}.txt`), url);
  console.log(`[dev] magic link for ${email}: ${url}`);
}
