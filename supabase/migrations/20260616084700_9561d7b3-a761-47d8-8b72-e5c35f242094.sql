DROP TRIGGER IF EXISTS tr_pv_set_locked_at ON public.pv;
DROP TRIGGER IF EXISTS tr_pv_block_locked_changes ON public.pv;
DROP TRIGGER IF EXISTS pv_set_locked_at_trg ON public.pv;
CREATE TRIGGER pv_set_locked_at_trg
BEFORE INSERT OR UPDATE ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_set_locked_at();