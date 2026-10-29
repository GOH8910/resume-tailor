import { BankInputSchema } from "@/bank/schema";
import { banks } from "@/lib/deps";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";
import { jsonBytes, MAX_BANK_JSON_BYTES } from "@/lib/input-caps";
import { limitUser } from "@/lib/limits";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    return Response.json(await banks.read(user.id));
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    limitUser("bankWrite", user);
    const body = await readJson(request);
    // Bytes, not string length: a character outside ASCII takes up to 4 bytes to store.
    if (jsonBytes(body) > MAX_BANK_JSON_BYTES) {
      throw new AppError(`The bank is too large to save: keep it under ${MAX_BANK_JSON_BYTES / 1000} KB`, 413);
    }
    // A ZodError becomes a 400 naming the first problem (handle()).
    return Response.json(await banks.write(user.id, BankInputSchema.parse(body)));
  });
}
