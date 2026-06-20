import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { EDIT_COOKIE } from "@/lib/auth";

export async function POST() {
  const store = await cookies();
  store.delete(EDIT_COOKIE);
  return NextResponse.json({ ok: true });
}
