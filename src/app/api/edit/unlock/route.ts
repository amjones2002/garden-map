import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkPassword, issueToken, EDIT_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";

export async function POST(req: Request) {
  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // no/invalid body → treat as empty password
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const store = await cookies();
  store.set(EDIT_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return NextResponse.json({ ok: true });
}
