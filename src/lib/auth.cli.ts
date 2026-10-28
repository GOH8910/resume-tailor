// Entry point for the Better Auth CLI (`npm run auth:generate`), which needs an exported instance. The app never imports this.
import { getAuth } from "./auth";

export const auth = getAuth();
