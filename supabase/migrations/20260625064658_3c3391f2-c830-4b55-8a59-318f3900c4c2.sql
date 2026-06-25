
-- 1. Compteur par société
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS chantier_reference_next integer NOT NULL DEFAULT 1;

-- 2. Colonne reference (nullable d'abord pour backfill)
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS reference varchar(16);

-- 3. Fonction de génération : CH + 4 chiffres + 2 lettres aléatoires
CREATE OR REPLACE FUNCTION public.generate_chantier_reference(_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _next int;
  _letters text;
  _ref text;
  _attempts int := 0;
  _exists boolean;
BEGIN
  -- S'assurer que la ligne settings existe
  INSERT INTO public.company_settings (company_id) VALUES (_company_id)
    ON CONFLICT (company_id) DO NOTHING;

  -- Verrou et incrément
  SELECT chantier_reference_next INTO _next
    FROM public.company_settings
    WHERE company_id = _company_id
    FOR UPDATE;
  IF _next IS NULL OR _next < 1 THEN _next := 1; END IF;

  LOOP
    _attempts := _attempts + 1;
    _letters := chr(65 + floor(random()*26)::int) || chr(65 + floor(random()*26)::int);
    _ref := 'CH' || lpad(_next::text, 4, '0') || _letters;

    SELECT EXISTS(
      SELECT 1 FROM public.chantiers
       WHERE company_id = _company_id AND reference = _ref
    ) INTO _exists;

    EXIT WHEN NOT _exists;
    IF _attempts > 50 THEN
      _next := _next + 1;
      _attempts := 0;
    END IF;
  END LOOP;

  UPDATE public.company_settings
    SET chantier_reference_next = _next + 1,
        updated_at = now()
    WHERE company_id = _company_id;

  RETURN _ref;
END
$$;

-- 4. Backfill déterministe pour les chantiers existants
DO $$
DECLARE
  _co record;
  _ch record;
  _idx int;
  _letters text;
  _ref text;
  _a int;
  _b int;
BEGIN
  FOR _co IN SELECT DISTINCT company_id FROM public.chantiers WHERE reference IS NULL LOOP
    _idx := 0;
    FOR _ch IN
      SELECT id FROM public.chantiers
       WHERE company_id = _co.company_id AND reference IS NULL
       ORDER BY created_at, id
    LOOP
      _idx := _idx + 1;
      -- 2 lettres déterministes basées sur l'index (AA, AB, ... AZ, BA, ...)
      _a := ((_idx - 1) / 26) % 26;
      _b := (_idx - 1) % 26;
      _letters := chr(65 + _a) || chr(65 + _b);
      _ref := 'CH' || lpad(_idx::text, 4, '0') || _letters;
      UPDATE public.chantiers SET reference = _ref WHERE id = _ch.id;
    END LOOP;
    -- Mettre à jour le compteur pour la prochaine création
    INSERT INTO public.company_settings (company_id, chantier_reference_next)
      VALUES (_co.company_id, _idx + 1)
      ON CONFLICT (company_id) DO UPDATE
        SET chantier_reference_next = GREATEST(public.company_settings.chantier_reference_next, _idx + 1),
            updated_at = now();
  END LOOP;
END $$;

-- 5. NOT NULL + index unique par société
ALTER TABLE public.chantiers ALTER COLUMN reference SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chantiers_company_reference_uq
  ON public.chantiers (company_id, reference);

CREATE INDEX IF NOT EXISTS chantiers_reference_search_idx
  ON public.chantiers (reference);

-- 6. Trigger BEFORE INSERT : auto-génération si absente
CREATE OR REPLACE FUNCTION public.chantier_assign_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := public.generate_chantier_reference(NEW.company_id);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chantier_assign_reference ON public.chantiers;
CREATE TRIGGER trg_chantier_assign_reference
  BEFORE INSERT ON public.chantiers
  FOR EACH ROW EXECUTE FUNCTION public.chantier_assign_reference();

-- 7. Trigger BEFORE UPDATE : la référence est immuable
CREATE OR REPLACE FUNCTION public.chantier_reference_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'CHANTIER_REFERENCE_IMMUTABLE: la référence chantier ne peut pas être modifiée.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chantier_reference_immutable ON public.chantiers;
CREATE TRIGGER trg_chantier_reference_immutable
  BEFORE UPDATE ON public.chantiers
  FOR EACH ROW EXECUTE FUNCTION public.chantier_reference_immutable();
