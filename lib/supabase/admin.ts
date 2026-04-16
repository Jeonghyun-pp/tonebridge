/**
 * Service-role Supabase client — bypasses RLS.
 * ONLY use in trusted server contexts (cron jobs, webhooks, admin scripts).
 * NEVER import this into client components.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin client");
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
