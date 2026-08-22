insert into chantiers (id, owner_id, company_id, name, address, status)
values ('11111111-aaaa-4aaa-8aaa-000000000001','a6a5bca3-7c1a-429e-bef6-dd37afdd7d0a','d6b7b3e7-dadb-42b4-98be-19bf02debae3','ZZPVDETAIL Chantier avec un nom extremement long pour tester la troncature responsive du header mobile','12 avenue des Tests Extremement Longue Adresse Pour Verifier Le Debordement Horizontal 75011 Paris','en_cours')
on conflict (id) do nothing;

insert into clients (id, owner_id, company_id, name, email, phone, address, client_type)
values ('11111111-bbbb-4bbb-8bbb-000000000001','a6a5bca3-7c1a-429e-bef6-dd37afdd7d0a','d6b7b3e7-dadb-42b4-98be-19bf02debae3','ZZPVDETAIL Client Societe Anonyme Immobiliere De Construction Du Grand Paris','contact.tres.long.adresse.email@societe-immobiliere-du-grand-paris-exemple.fr','+33 6 12 34 56 78','1 rue du Test','entreprise')
on conflict (id) do nothing;

insert into pv (id, owner_id, company_id, chantier_id, client_id, numero, type, status, reception_date, description, observations, reception_with_reserves, chantier_address, chantier_postal_code, chantier_city, reserve_completion_delay, reserve_due_date)
values (
 '11111111-cccc-4ccc-8ccc-000000000001','a6a5bca3-7c1a-429e-bef6-dd37afdd7d0a','d6b7b3e7-dadb-42b4-98be-19bf02debae3',
 '11111111-aaaa-4aaa-8aaa-000000000001','11111111-bbbb-4bbb-8bbb-000000000001',
 'ZZPVDETAIL-2026-000000001-NUMERO-TRES-LONG','reception','brouillon', current_date,
 repeat('Description tres longue des travaux realises sur le chantier de test afin de verifier le comportement du bloc description et du bouton voir plus. ', 6),
 repeat('Observations longues. ', 20), true,
 '12 avenue des Tests Extremement Longue Adresse Pour Verifier Le Debordement','75011','Paris','30 jours', current_date + 30
) on conflict (id) do nothing;

insert into pv_reserves (pv_id, owner_id, company_id, description, severity, status, priority, work_to_execute, due_date)
select '11111111-cccc-4ccc-8ccc-000000000001','a6a5bca3-7c1a-429e-bef6-dd37afdd7d0a','d6b7b3e7-dadb-42b4-98be-19bf02debae3',
  'ZZRESERVEDETAIL '||i||' — '||repeat('description de reserve tres longue sans espaces_insecables_pour_tester_le_wrapping ', 3),
  case when i % 2 = 0 then 'majeure' else 'mineure' end,
  case when i % 3 = 0 then 'levee' when i % 5 = 0 then 'validee' else 'ouverte' end,
  case when i % 4 = 0 then 'high' else 'normal' end,
  repeat('Travaux a executer detailles ', 4),
  current_date - (i % 7)
from generate_series(1,20) i;