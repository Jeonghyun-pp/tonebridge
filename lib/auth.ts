/**
 * Server-side auth helpers for API routes and Server Components.
 *
 * `requireUser()` is the canonical "this code path needs an authenticated user"
 * call. It returns null instead of throwing so the caller can shape the
 * response appropriately (401 in API routes, redirect in Server Components).
 *
 * Pairs with the auth_user_sync trigger (0008) — we never need to manually
 * mirror auth.users into public.users.
 */
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { users, type User } from "@/lib/db/schema";

export interface AuthSession {
  authId: string;
  email: string | null;
  profile: User;
}

export async function getSession(): Promise<AuthSession | null> {
  const supa = await createClient();
  const { data } = await supa.auth.getUser();
  const authUser = data.user;
  if (!authUser) return null;

  const rows = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  let profile = rows[0];

  // Defensive: if the trigger somehow didn't fire (e.g. signup happened before
  // 0008 was applied), upsert ourselves. Idempotent.
  if (!profile) {
    const inserted = await db
      .insert(users)
      .values({ id: authUser.id, email: authUser.email ?? null })
      .onConflictDoNothing()
      .returning();
    profile = inserted[0] ?? (await db.select().from(users).where(eq(users.id, authUser.id)).limit(1))[0];
  }

  return {
    authId: authUser.id,
    email: authUser.email ?? null,
    profile,
  };
}

/** Throw-style variant for API routes that want to short-circuit on missing auth. */
export async function requireUser(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    const err = new Error("unauthorized") as Error & { status: number };
    err.status = 401;
    throw err;
  }
  return session;
}
