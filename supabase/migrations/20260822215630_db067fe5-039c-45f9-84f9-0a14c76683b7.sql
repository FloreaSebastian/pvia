UPDATE public.plan_limits
SET monthly_price_eur = 0,
    annual_price_eur = NULL,
    stripe_price_monthly = NULL,
    stripe_price_annual = NULL,
    updated_at = now()
WHERE plan = 'enterprise' AND is_custom_pricing = true;