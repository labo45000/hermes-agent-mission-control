import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PROFILE_STORE_KEY, buildProfileRoster, type ProfileInput } from "@/lib/personal-dashboard";

export const dynamic = "force-dynamic";

function profilePayload(data: unknown): { profiles: ProfileInput[]; syncedAt: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { profiles: [], syncedAt: null };
  const record = data as Record<string, unknown>;
  return {
    profiles: Array.isArray(record.profiles) ? record.profiles as ProfileInput[] : [],
    syncedAt: typeof record.syncedAt === "string" ? record.syncedAt : null,
  };
}

export async function GET() {
  try {
    const row = await prisma.dataStore.findUnique({ where: { key: PROFILE_STORE_KEY } });
    const payload = profilePayload(row?.data);
    return NextResponse.json({
      profiles: buildProfileRoster(payload.profiles),
      syncedAt: payload.syncedAt,
      chat: { status: "unavailable", reason: "No verified profile chat route is configured." },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      profiles: buildProfileRoster(),
      syncedAt: null,
      chat: { status: "unavailable", reason: "Profile mirror unavailable." },
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
