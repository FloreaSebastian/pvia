import { createFileRoute } from "@tanstack/react-router";
import { getStripeClient } from "@/lib/stripe.server";

// TEMPORAIRE — outil d'administration fiscale Stripe (sandbox). À supprimer.
export const Route = createFileRoute("/api/public/__tax-setup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
        };
        const stripe = getStripeClient("sandbox") as any;
        try {
          if (body.action === "configure") {
            await stripe.tax.settings.update({
              defaults: { tax_behavior: "exclusive", tax_code: "txcd_10103001" },
              head_office: { address: { country: "FR" } },
            });
            const existing = await stripe.tax.registrations.list({ status: "active", limit: 100 });
            if (!existing.data.some((r: any) => r.country === "FR")) {
              await stripe.tax.registrations.create({
                country: "FR",
                country_options: { fr: { type: "standard" } },
                active_from: "now",
              });
            }
          }
          const [settings, regs, account] = await Promise.all([
            stripe.tax.settings.retrieve(),
            stripe.tax.registrations.list({ limit: 100 }),
            stripe.accounts.retrieve().catch(() => null),
          ]);
          return Response.json({
            ok: true,
            settings,
            registrations: regs.data.map((r: any) => ({ country: r.country, status: r.status, type: r.country_options })),
            account: account && {
              country: account.country,
              business_type: account.business_type,
              business_profile: account.business_profile,
              company: account.company,
            },
          });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
