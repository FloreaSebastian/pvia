-- Ensure required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove previous schedule (ignore if absent)
do $$
begin
  perform cron.unschedule('pvia-check-expiring-trials');
exception when others then null;
end $$;

-- Reschedule using x-cron-secret read from Vault at call time.
-- The Vault entry 'pvia_cron_secret' must contain the same value as the
-- CRON_SECRET environment secret used by the endpoint.
select cron.schedule(
  'pvia-check-expiring-trials',
  '0 8 * * *',
  $cron$
  select net.http_post(
    url := 'https://project--62dfa2d7-a1fe-4be0-a702-1b1f51433b81.lovable.app/api/public/hooks/check-expiring-trials',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pvia_cron_secret' limit 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);