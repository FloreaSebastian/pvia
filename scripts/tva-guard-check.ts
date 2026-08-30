/** Vérifie la garde fiscale (lecture seule, aucun paiement). */
import { createStripeClient, assertTaxComplianceReady, hasActiveFrenchTaxRegistration } from "../src/lib/stripe.server";

for (const env of ["sandbox", "live"] as const) {
  const stripe = createStripeClient(env);
  const fr = await hasActiveFrenchTaxRegistration(stripe);
  let guard = "PASSE";
  try {
    await assertTaxComplianceReady(env, stripe);
  } catch (e: any) {
    guard = `BLOQUE — ${e.message}`;
  }
  console.log(`${env}: registration FR active=${fr} | garde checkout: ${guard}`);
}
