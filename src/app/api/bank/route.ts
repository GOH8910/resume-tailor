import { BankInputSchema } from "@/bank/schema";
import { banks } from "@/lib/deps";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";
import { MAX_BANK_JSON_CHARS } from "@/lib/input-caps";
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
    if (JSON.stringify(body).length > MAX_BANK_JSON_CHARS) {
      throw new AppError(`The bank is too large to save: keep it under ${MAX_BANK_JSON_CHARS.toLocaleString("en")} characters`, 413);
    }
    const parsed = BankInputSchema.safeParse(body);
    if (!parsed.success) throw new AppError("Bank does not match the schema", 400, parsed.error.issues);
    return Response.json(await banks.write(user.id, parsed.data));
  });
}
