import "server-only";
import { cookies } from "next/headers";
import { EDIT_COOKIE, isUnlocked } from "./auth";

/** True when the current request carries a valid edit session cookie. */
export async function requireEdit(): Promise<boolean> {
  const token = (await cookies()).get(EDIT_COOKIE)?.value;
  return isUnlocked(token);
}
