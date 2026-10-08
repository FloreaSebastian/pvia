DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.technical_visit_photos
    GROUP BY company_id, visit_id, storage_path HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'technical_visit_photos: doublons historiques de storage_path détectés, index unique non créé (aucune suppression automatique).';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS technical_visit_photos_company_visit_path_uniq
      ON public.technical_visit_photos (company_id, visit_id, storage_path);
  END IF;
END $$;