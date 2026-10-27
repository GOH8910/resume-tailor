import { banks } from "@/lib/deps";
import { handle, readJson, requireProfile } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => Response.json(await banks.read(requireProfile(request))));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const profile = requireProfile(request);
    const bank = await banks.write(profile, await readJson(request));
    return Response.json(bank);
  });
}
