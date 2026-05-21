
-- Add remote signature columns to pv
ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS sign_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS sign_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to_client_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to_email text;

CREATE INDEX IF NOT EXISTS pv_sign_token_idx ON public.pv (sign_token) WHERE sign_token IS NOT NULL;

-- Public RLS: read PV by valid token (anon + authenticated)
DROP POLICY IF EXISTS pv_select_by_token ON public.pv;
CREATE POLICY pv_select_by_token ON public.pv
  FOR SELECT
  TO anon, authenticated
  USING (
    sign_token IS NOT NULL
    AND (sign_token_expires_at IS NULL OR sign_token_expires_at > now())
  );

-- Allow public read of related photos when parent pv has active token
DROP POLICY IF EXISTS pv_photos_select_by_token ON public.pv_photos;
CREATE POLICY pv_photos_select_by_token ON public.pv_photos
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pv p
    WHERE p.id = pv_photos.pv_id
      AND p.sign_token IS NOT NULL
      AND (p.sign_token_expires_at IS NULL OR p.sign_token_expires_at > now())
  ));

DROP POLICY IF EXISTS pv_reserves_select_by_token ON public.pv_reserves;
CREATE POLICY pv_reserves_select_by_token ON public.pv_reserves
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pv p
    WHERE p.id = pv_reserves.pv_id
      AND p.sign_token IS NOT NULL
      AND (p.sign_token_expires_at IS NULL OR p.sign_token_expires_at > now())
  ));

-- Allow public read of related company name for branding on the signature page
DROP POLICY IF EXISTS companies_select_by_pv_token ON public.companies;
CREATE POLICY companies_select_by_pv_token ON public.companies
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pv p
    WHERE p.company_id = companies.id
      AND p.sign_token IS NOT NULL
      AND (p.sign_token_expires_at IS NULL OR p.sign_token_expires_at > now())
  ));

-- Notification trigger on sent_to_client
CREATE OR REPLACE FUNCTION public.notify_pv_sent_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if NEW.sent_to_client_at IS NOT NULL AND (OLD.sent_to_client_at IS NULL OR OLD.sent_to_client_at <> NEW.sent_to_client_at) then
    insert into public.notifications(company_id, user_id, type, title, body)
      values (NEW.company_id, NEW.owner_id, 'pv_sent', 'PV envoyé au client',
              'Le PV ' || coalesce(NEW.numero,'') || ' a été envoyé à ' || coalesce(NEW.sent_to_email,'le client') || '.');
  end if;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS pv_sent_to_client_notify ON public.pv;
CREATE TRIGGER pv_sent_to_client_notify
  AFTER UPDATE OF sent_to_client_at ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.notify_pv_sent_to_client();
