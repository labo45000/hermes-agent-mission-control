import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  GARDEN_EMPTY,
  GARDEN_STORE_KEY,

  isGardenMutationAuthorized,
  parseGardenOperation,
  validateGarden,
} from "@/lib/personal-dashboard";
import { handleGardenMutation, type GardenTransactionRepository } from "@/lib/garden-route-service";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const row = await prisma.dataStore.findUnique({ where: { key: GARDEN_STORE_KEY } });
    if (!row) return NextResponse.json(GARDEN_EMPTY, { headers: noStore });
    const parsed = validateGarden(row.data);
    if (!parsed.ok) {
      return NextResponse.json({ error: "Garden data is invalid. Repair the persisted garden before retrying." }, { status: 500, headers: noStore });
    }
    return NextResponse.json(parsed.value, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Garden is unavailable. Check database connectivity and retry." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isGardenMutationAuthorized(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400, headers: noStore });
  }
  const parsedOperation = parseGardenOperation(body);
  if (!parsedOperation.ok) {
    return NextResponse.json({ error: parsedOperation.error }, { status: 400, headers: noStore });
  }

  try {
    const repository: GardenTransactionRepository = {
      runSerialized: (work) => prisma.$transaction(async (transaction) => {
        // The lock is acquired before the read, making revision comparison and write one serialized unit.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${GARDEN_STORE_KEY}))`;
        const row = await transaction.dataStore.findUnique({ where: { key: GARDEN_STORE_KEY } });
        const parsedGarden = row ? validateGarden(row.data) : { ok: true as const, value: GARDEN_EMPTY };
        if (!parsedGarden.ok) throw new Error("Invalid persisted garden");
        const outcome = await work(parsedGarden.value);
        if (outcome.nextGarden) {
          await transaction.dataStore.upsert({
            where: { key: GARDEN_STORE_KEY },
            create: { key: GARDEN_STORE_KEY, data: outcome.nextGarden },
            update: { data: outcome.nextGarden },
          });
        }
        return outcome.result;
      }),
    };
    const result = await handleGardenMutation(parsedOperation.value, repository);
    return NextResponse.json(result.body, { status: result.status, headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Garden could not be saved";
    if (message === "Plant not found") return NextResponse.json({ error: message }, { status: 404, headers: noStore });
    if (message === "Garden plant limit reached") return NextResponse.json({ error: message }, { status: 409, headers: noStore });
    return NextResponse.json({ error: "Garden could not be saved. Retry without closing this page." }, { status: 503, headers: noStore });
  }
}
