DELETE FROM public.pv_photos WHERE pv_id = '11111111-cccc-4ccc-8ccc-000000000001';
DELETE FROM public.pv_reserves WHERE pv_id = '11111111-cccc-4ccc-8ccc-000000000001';
DELETE FROM public.pv WHERE id = '11111111-cccc-4ccc-8ccc-000000000001';
DELETE FROM public.chantiers WHERE name LIKE 'ZZPVDETAIL%';
DELETE FROM public.clients WHERE name LIKE 'ZZPVDETAIL%';