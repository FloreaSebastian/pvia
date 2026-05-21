CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily trial-expiration check at 09:00 UTC
SELECT cron.schedule(
  'pvia-check-expiring-trials',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--62dfa2d7-a1fe-4be0-a702-1b1f51433b81.lovable.app/api/public/hooks/check-expiring-trials',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFueHliZXV3em5wbXd5d21jdmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjUwNjAsImV4cCI6MjA5NDk0MTA2MH0.eG4PGShdvWO2pAnhAPP0DYf4ZTb9cKwpqXm0Szf7JYk"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);