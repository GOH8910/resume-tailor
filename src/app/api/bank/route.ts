import { banks } from "@/lib/deps";
import { handle, readJson, requireUser } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    // Idempotent: heals an account whose sign-up hook failed to create the bank.
    await banks.createEmpty(user.id, user.name);
    return Response.json(await banks.read(user.id));
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    const bank = await banks.write(user.id, await readJson(request));
    return Response.json(bank);
  });
}
