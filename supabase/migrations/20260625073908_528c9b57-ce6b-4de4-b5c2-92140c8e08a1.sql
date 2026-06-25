-- 1) Unicité des libellés par chantier (partielle pour les anciennes lignes sans label)
CREATE UNIQUE INDEX IF NOT EXISTS chantier_photos_chantier_label_uq
  ON public.chantier_photos (chantier_id, label)
  WHERE label IS NOT NULL;

-- 2) Génération transactionnelle du prochain libellé
CREATE OR REPLACE FUNCTION public.next_chantier_photo_label(_chantier_id uuid, _photo_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref text;
  v_prefix text;
  v_n int;
  v_label text;
BEGIN
  -- Verrou pessimiste sur la ligne chantier pour sérialiser la génération
  SELECT reference INTO v_ref FROM public.chantiers WHERE id = _chantier_id FOR UPDATE;
  IF v_ref IS NULL THEN v_ref := 'CHANTIER'; END IF;

  v_prefix := CASE _photo_type
    WHEN 'before' THEN 'AVANT'
    WHEN 'during' THEN 'PENDANT'
    WHEN 'after'  THEN 'FIN'
    ELSE upper(_photo_type)
  END;

  -- Plus grand suffixe numérique existant + 1 (robuste aux suppressions)
  SELECT COALESCE(MAX(
           NULLIF(regexp_replace(label, '^.*-(\d{3,})$', '\1'), label)::int
         ), 0) + 1
    INTO v_n
    FROM public.chantier_photos
   WHERE chantier_id = _chantier_id
     AND photo_type = _photo_type
     AND label IS NOT NULL;

  v_label := v_ref || '-' || v_prefix || '-' || lpad(v_n::text, 3, '0');
  RETURN v_label;
END
$$;

GRANT EXECUTE ON FUNCTION public.next_chantier_photo_label(uuid, text) TO authenticated, service_role;