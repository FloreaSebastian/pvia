
-- New table for reserve-lift photos with before/after distinction + geolocation
CREATE TABLE public.reserve_lift_item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pv_id uuid NOT NULL REFERENCES public.pv(id) ON DELETE CASCADE,
  reserve_id uuid NOT NULL REFERENCES public.pv_reserves(id) ON DELETE CASCADE,
  reserve_lift_item_id uuid NOT NULL REFERENCES public.reserve_lift_items(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  storage_path text NOT NULL,
  photo_type text NOT NULL CHECK (photo_type IN ('before','after','legacy')),
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  taken_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_info text,
  exif_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rlip_lift_item ON public.reserve_lift_item_photos(reserve_lift_item_id);
CREATE INDEX idx_rlip_reserve ON public.reserve_lift_item_photos(reserve_id);
CREATE INDEX idx_rlip_pv ON public.reserve_lift_item_photos(pv_id);
CREATE INDEX idx_rlip_company ON public.reserve_lift_item_photos(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reserve_lift_item_photos TO authenticated;
GRANT ALL ON public.reserve_lift_item_photos TO service_role;

ALTER TABLE public.reserve_lift_item_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read photos"
  ON public.reserve_lift_item_photos FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "members insert photos"
  ON public.reserve_lift_item_photos FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "members update photos"
  ON public.reserve_lift_item_photos FOR UPDATE
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "members delete photos"
  ON public.reserve_lift_item_photos FOR DELETE
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

-- Block writes when parent PV is locked (signed)
CREATE TRIGGER trg_rlip_block_locked
BEFORE INSERT OR UPDATE OR DELETE ON public.reserve_lift_item_photos
FOR EACH ROW EXECUTE FUNCTION public.pv_child_block_locked();
