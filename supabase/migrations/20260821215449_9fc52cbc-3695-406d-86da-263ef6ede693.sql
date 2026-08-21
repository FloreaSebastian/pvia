INSERT INTO public.chantiers (company_id, owner_id, name, status, address, progress_percent)
SELECT 'd6b7b3e7-dadb-42b4-98be-19bf02debae3', cm.user_id,
 'ZZTEST Chantier de rénovation énergétique globale avec isolation thermique par l''extérieur et remplacement complet des menuiseries aluminium du bâtiment C',
 'planifie',
 'ZZ 1234 Avenue Interminable des Très Longs Libellés de Voirie Administrative Sans Aucune Abréviation Possible, Bâtiment C, Escalier 12, 31000 Toulouse',
 99
FROM public.company_members cm
WHERE cm.company_id='d6b7b3e7-dadb-42b4-98be-19bf02debae3' AND cm.status='active'
ORDER BY cm.created_at LIMIT 1;