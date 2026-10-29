import { z } from "zod";

// Runs before any page code. Zod tries `new Function` the first time it builds an object schema, to compile faster
// parsers; the production Content-Security-Policy has no 'unsafe-eval', so the browser reports that attempt as a
// violation even though Zod catches it. jitless skips the attempt.
z.config({ jitless: true });
