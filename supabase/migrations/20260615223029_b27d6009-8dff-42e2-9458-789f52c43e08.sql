INSERT INTO public.launch_checklist_items (key, label, category, position, status)
VALUES (
  'auth_fallback_after_3_otp_failures',
  'Fallback connexion après 3 échecs OTP (mot de passe + SMS)',
  'security',
  (SELECT COALESCE(MAX(position), 0) + 1 FROM public.launch_checklist_items),
  'todo'
)
ON CONFLICT (key) DO NOTHING;