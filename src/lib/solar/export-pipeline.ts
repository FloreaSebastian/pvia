/**
 * Solar Studio V2 — P1.1 : ordre imposé des garde-fous d'un export persisté.
 *
 * 1. appartenance à l'entreprise ;
 * 2. abonnement utilisable (un export écrit un fichier dans le stockage) ;
 * 3. génération ;
 * 4. écriture.
 * Si une garde échoue, rien n'est généré ni écrit.
 */
export interface SolarExportSteps<T> {
  assertMember: () => Promise<void>;
  assertSubscription: () => Promise<void>;
  build: () => Promise<Uint8Array>;
  upload: (bytes: Uint8Array) => Promise<T>;
}

export async function runSolarExport<T>(steps: SolarExportSteps<T>): Promise<T> {
  await steps.assertMember();
  await steps.assertSubscription();
  const bytes = await steps.build();
  return steps.upload(bytes);
}
