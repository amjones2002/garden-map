import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { EDIT_COOKIE, isUnlocked } from "@/lib/auth";

export async function GET() {
  const token = (await cookies()).get(EDIT_COOKIE)?.value;
  return NextResponse.json({ unlocked: isUnlocked(token) });
}
