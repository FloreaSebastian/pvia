
-- 1) Replace pv_photos trigger: allow INSERT, block UPDATE/DELETE on signed PV
DROP TRIGGER IF EXISTS pv_photos_block_locked_trg ON public.pv_photos;
CREATE TRIGGER pv_photos_block_locked_trg
  BEFORE UPDATE OR DELETE ON public.pv_photos
  FOR EACH ROW EXECUTE FUNCTION public.pv_child_block_locked();

-- 2) Replace pv_reserves trigger: allow UPDATE (status changes through lift workflow), block only DELETE
DROP TRIGGER IF EXISTS pv_reserves_block_locked_trg ON public.pv_reserves;
CREATE TRIGGER pv_reserves_block_locked_trg
  BEFORE DELETE ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.pv_child_block_locked();

-- 3) Remove lock guard on reserve lift photos entirely — the lift workflow MUST work on signed PVs
DROP TRIGGER IF EXISTS trg_rlip_block_locked ON public.reserve_lift_item_photos;
