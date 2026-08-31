ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS price_id text,
  ADD COLUMN IF NOT EXISTS billing_interval text;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('monthly','annual'));