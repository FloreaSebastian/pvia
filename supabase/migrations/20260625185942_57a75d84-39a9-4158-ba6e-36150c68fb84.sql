CREATE UNIQUE INDEX IF NOT EXISTS pv_chantier_unique_idx
  ON public.pv (chantier_id)
  WHERE chantier_id IS NOT NULL;