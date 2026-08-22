CREATE OR REPLACE FUNCTION public.increment_rate_limit(_bucket text, _key text, _window_start timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c integer;
BEGIN
  INSERT INTO public.rate_limits (bucket, key, window_start, count)
  VALUES (_bucket, _key, _window_start, 1)
  ON CONFLICT (bucket, key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING public.rate_limits.count INTO c;
  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_rate_limit(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(text, text, timestamptz) TO service_role;