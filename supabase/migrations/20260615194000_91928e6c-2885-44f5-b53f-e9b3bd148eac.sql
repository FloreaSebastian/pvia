-- Promote contact@pvia.fr to platform_admin (idempotent)
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'platform_admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'contact@pvia.fr'
ON CONFLICT (user_id, role) DO NOTHING;

-- Optional: log
INSERT INTO public.audit_logs(user_id, entity_type, action, metadata)
SELECT u.id, 'platform_admin', 'role.platform_admin_granted',
       jsonb_build_object('email', u.email, 'via', 'migration')
FROM auth.users u
WHERE lower(u.email) = 'contact@pvia.fr';
