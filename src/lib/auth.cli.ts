// Entry point for the Better Auth CLI (`npm run auth:generate`), which needs an exported instance. The app never imports this.
// It opens data/pglite (unless DATABASE_URL is set), so stop `next dev` first: only one process may hold that folder.
// better-auth, @better-auth/drizzle-adapter and the CLI version in the auth:generate script are pinned to the same
// version: bump them together.
import { getAuth } from "./auth";

export const auth = getAuth();
