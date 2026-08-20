import * as React from "react";
import type SignaturePad from "react-signature-canvas";

type PadRef = React.RefObject<SignaturePad | null>;

/**
 * Rend un pad de signature réellement responsive.
 *
 * Le canvas HTML possède une taille de buffer indépendante de sa taille CSS :
 * lors d'un changement de largeur (rotation, Fold fermé ↔ ouvert, clavier),
 * le tracé se déforme ou disparaît. On resynchronise le buffer avec la taille
 * CSS puis on **restaure les points déjà tracés** (aucune perte de signature).
 */
export function useSignatureResize(...pads: PadRef[]) {
  const padsRef = React.useRef(pads);
  padsRef.current = pads;

  React.useEffect(() => {
    let frame = 0;

    const resizeOne = (pad: SignaturePad | null) => {
      if (!pad) return;
      const canvas = pad.getCanvas?.();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const nextW = Math.round(rect.width * ratio);
      const nextH = Math.round(rect.height * ratio);
      if (canvas.width === nextW && canvas.height === nextH) return;

      // Sauvegarde du tracé avant redimensionnement (le resize vide le canvas).
      let data: ReturnType<SignaturePad["toData"]> | null = null;
      try {
        data = pad.isEmpty() ? null : pad.toData();
      } catch {
        data = null;
      }

      canvas.width = nextW;
      canvas.height = nextH;
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();

      if (data && data.length > 0) {
        try {
          pad.fromData(data);
        } catch {
          /* tracé non restaurable : on laisse le canvas propre */
        }
      }
    };

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => padsRef.current.forEach((p) => resizeOne(p.current)));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
}
