-- Nettoyage des jeux de données d'audit préfixés ZZ.
-- Les triggers de verrouillage métier empêchent la suppression des PV signés
-- de test : on les désactive le temps du nettoyage puis on les rétablit.
ALTER TABLE public.pv DISABLE TRIGGER USER;
ALTER TABLE public.pv_reserves DISABLE TRIGGER USER;
ALTER TABLE public.reserve_lift_reports DISABLE TRIGGER USER;
ALTER TABLE public.chantiers DISABLE TRIGGER USER;

DELETE FROM public.pv WHERE company_id IN (SELECT id FROM public.companies WHERE name ILIKE 'ZZ%');

DELETE FROM public.chantiers WHERE company_id IN (SELECT id FROM public.companies WHERE name ILIKE 'ZZ%');
DELETE FROM public.chantiers
WHERE reference ILIKE 'ZZ%' OR coalesce(name,'') ILIKE 'ZZ%' OR coalesce(address,'') ILIKE 'ZZ%';

DELETE FROM public.clients WHERE coalesce(name,'') ILIKE 'ZZ%';

DELETE FROM public.subscriptions
WHERE company_id IN (SELECT id FROM public.companies WHERE name ILIKE 'ZZ%')
   OR stripe_subscription_id ILIKE '%ZZ%';

DELETE FROM public.companies WHERE name ILIKE 'ZZ%';

ALTER TABLE public.pv ENABLE TRIGGER USER;
ALTER TABLE public.pv_reserves ENABLE TRIGGER USER;
ALTER TABLE public.reserve_lift_reports ENABLE TRIGGER USER;
ALTER TABLE public.chantiers ENABLE TRIGGER USER;