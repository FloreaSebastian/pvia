import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listQueue, flushQueue, type FieldOp } from "@/lib/field-offline";
import { addFieldPhoto, addFieldReserve, saveFieldDraft } from "@/lib/field.functions";
import { useOnlineStatus } from "./use-online-status";

export function useFieldQueue() {
  const [ops, setOps] = useState<FieldOp[]>([]);
  const [flushing, setFlushing] = useState(false);
  const online = useOnlineStatus();

  const addPhotoFn = useServerFn(addFieldPhoto);
  const addReserveFn = useServerFn(addFieldReserve);
  const saveDraftFn = useServerFn(saveFieldDraft);

  const refresh = useCallback(async () => {
    try {
      setOps(await listQueue());
    } catch {
      setOps([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const h = () => refresh();
    window.addEventListener("pvia:queue-changed", h);
    return () => window.removeEventListener("pvia:queue-changed", h);
  }, [refresh]);

  const flush = useCallback(async () => {
    if (flushing) return;
    setFlushing(true);
    try {
      await flushQueue({
        photo: async (op) => {
          await addPhotoFn({ data: { pvId: op.pvId, dataUrl: op.dataUrl, kind: op.kind as never, caption: op.caption ?? null } });
        },
        reserve: async (op) => {
          await addReserveFn({ data: { pvId: op.pvId, description: op.description, severity: op.severity } });
        },
        save: async (op) => {
          await saveDraftFn({ data: { pvId: op.pvId, patch: op.patch as never } });
        },
      });
    } finally {
      setFlushing(false);
      refresh();
    }
  }, [flushing, addPhotoFn, addReserveFn, saveDraftFn, refresh]);

  useEffect(() => {
    if (online && ops.length > 0) flush();
  }, [online, ops.length, flush]);

  return { ops, online, flushing, flush, refresh };
}
