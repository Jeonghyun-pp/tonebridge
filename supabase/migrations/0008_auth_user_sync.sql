-- =============================================================================
-- ToneBridge — Auto-sync auth.users → public.users (S11)
--
-- Supabase Auth manages auth.users (private schema). Our app code reads/writes
-- public.users via RLS policies. This trigger creates the public.users row
-- automatically on signup so we never have an orphaned auth user.
--
-- ON CONFLICT DO NOTHING so re-running migrations is safe and so manual inserts
-- (e.g. seeding test users) don't conflict with the trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
