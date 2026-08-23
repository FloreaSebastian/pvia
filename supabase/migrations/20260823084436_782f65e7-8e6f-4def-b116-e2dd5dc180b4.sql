-- 1) Global client identity
CREATE TABLE IF NOT EXISTS public.client_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_at timestamptz,
  activated_at timestamptz,
  last_login_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_identities_status_chk CHECK (status IN ('pending','invited','active','disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS client_identities_email_uidx
  ON public.client_identities (normalized_email);

GRANT ALL ON public.client_identities TO service_role;
ALTER TABLE public.client_identities ENABLE ROW LEVEL SECURITY;
-- Deny-all by design: the client area is served exclusively by trusted server
-- functions (service role), like client_sessions / client_auth_codes.
DROP POLICY IF EXISTS "client_identities_no_direct_access" ON public.client_identities;
CREATE POLICY "client_identities_no_direct_access"
  ON public.client_identities FOR SELECT TO authenticated USING (false);

DROP TRIGGER IF EXISTS set_client_identities_updated_at ON public.client_identities;
CREATE TRIGGER set_client_identities_updated_at
  BEFORE UPDATE ON public.client_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Business relation columns
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_identity_id uuid REFERENCES public.client_identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_suspended_by uuid;

CREATE INDEX IF NOT EXISTS clients_client_identity_id_idx
  ON public.clients (client_identity_id);

-- 3) Sessions carry the global identity (legacy client_id kept for compat)
ALTER TABLE public.client_sessions
  ADD COLUMN IF NOT EXISTS client_identity_id uuid REFERENCES public.client_identities(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS client_sessions_identity_idx
  ON public.client_sessions (client_identity_id);

ALTER TABLE public.client_auth_codes
  ADD COLUMN IF NOT EXISTS client_identity_id uuid REFERENCES public.client_identities(id) ON DELETE CASCADE;

-- 4) Atomic resolver (race-safe upsert, no raw duplicate-key error)
CREATE OR REPLACE FUNCTION public.resolve_client_identity(_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text;
  _id uuid;
BEGIN
  _norm := lower(btrim(coalesce(_email, '')));
  IF _norm = '' OR _norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.client_identities (normalized_email)
  VALUES (_norm)
  ON CONFLICT (normalized_email) DO NOTHING
  RETURNING id INTO _id;

  IF _id IS NULL THEN
    SELECT id INTO _id FROM public.client_identities WHERE normalized_email = _norm;
  END IF;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_client_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_client_identity(text) TO service_role;

-- 5) Auto-link on client insert / email change
CREATE OR REPLACE FUNCTION public.clients_link_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
    IF TG_OP = 'INSERT'
       OR NEW.client_identity_id IS NULL
       OR lower(btrim(coalesce(NEW.email,''))) IS DISTINCT FROM lower(btrim(coalesce(OLD.email,''))) THEN
      NEW.client_identity_id := public.resolve_client_identity(NEW.email);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND (NEW.email IS NULL OR btrim(NEW.email) = '') THEN
    NEW.client_identity_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_link_identity_trg ON public.clients;
CREATE TRIGGER clients_link_identity_trg
  BEFORE INSERT OR UPDATE OF email ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_link_identity();

-- 6) Idempotent backfill of existing clients
INSERT INTO public.client_identities (normalized_email)
SELECT DISTINCT lower(btrim(email))
FROM public.clients
WHERE email IS NOT NULL
  AND lower(btrim(email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
ON CONFLICT (normalized_email) DO NOTHING;

UPDATE public.clients c
SET client_identity_id = ci.id
FROM public.client_identities ci
WHERE c.client_identity_id IS NULL
  AND c.email IS NOT NULL
  AND lower(btrim(c.email)) = ci.normalized_email;

-- Existing sessions: resolve their identity so nobody gets logged out.
INSERT INTO public.client_identities (normalized_email)
SELECT DISTINCT lower(btrim(s.email))
FROM public.client_sessions s
WHERE s.email IS NOT NULL
  AND lower(btrim(s.email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
ON CONFLICT (normalized_email) DO NOTHING;

UPDATE public.client_sessions s
SET client_identity_id = ci.id
FROM public.client_identities ci
WHERE s.client_identity_id IS NULL
  AND lower(btrim(s.email)) = ci.normalized_email;

-- Identities that already signed in at least once are considered active.
UPDATE public.client_identities ci
SET status = 'active',
    activated_at = COALESCE(ci.activated_at, sub.first_seen),
    last_login_at = COALESCE(ci.last_login_at, sub.last_seen)
FROM (
  SELECT client_identity_id, min(created_at) AS first_seen, max(last_seen_at) AS last_seen
  FROM public.client_sessions
  WHERE client_identity_id IS NOT NULL
  GROUP BY client_identity_id
) sub
WHERE ci.id = sub.client_identity_id
  AND ci.status = 'pending';