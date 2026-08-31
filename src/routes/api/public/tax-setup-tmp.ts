import { createFileRoute } from "@tanstack/react-router";
import { getStripeClient } from "@/lib/stripe.server";

// TEMPORAIRE — outil d'administration fiscale Stripe (sandbox). À supprimer.
export const Route = createFileRoute("/api/public/tax-setup-tmp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
        };
        const stripe = getStripeClient("sandbox") as any;
        try {
          if (body.action === "probe") {
            const prices = await stripe.prices.list({ limit: 5, active: true });
            const price = prices.data.find((pr: any) => pr.recurring) ?? prices.data[0];
            const customer = await stripe.customers.create({
              email: "tva-probe@pvia.fr",
              name: "Probe TVA",
              address: { line1: "1 rue de la Reception", postal_code: "75001", city: "Paris", country: "FR" },
            });
            const session = await stripe.checkout.sessions.create({
              mode: price?.recurring ? "subscription" : "payment",
              customer: customer.id,
              line_items: [{ price: price.id, quantity: 1 }],
              success_url: "https://pvia.fr/billing?status=success",
              cancel_url: "https://pvia.fr/billing?status=cancel",
              automatic_tax: { enabled: true },
              billing_address_collection: "required",
              customer_update: { name: "auto" },
              tax_id_collection: { enabled: true, required: "if_supported" },
            });
            const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ["total_details.breakdown"] });
            await stripe.checkout.sessions.expire(session.id).catch(() => {});
            await stripe.customers.del(customer.id).catch(() => {});
            return Response.json({
              ok: true,
              lookup_key: price?.lookup_key,
              tax_behavior: price?.tax_behavior,
              automatic_tax: full.automatic_tax,
              amount_subtotal: full.amount_subtotal,
              amount_total: full.amount_total,
              total_details: full.total_details,
              currency: full.currency,
            });
          }
          if (body.action === "legal") {
            await stripe.accounts.update({
              business_profile: {
                name: "PVIA",
                url: "https://pvia.fr",
                support_email: "contact@pvia.fr",
                support_url: "https://pvia.fr/contact",
              },
            });
          }
          if (body.action === "configure") {
            await stripe.tax.settings.update({
              defaults: { tax_behavior: "exclusive", tax_code: "txcd_10103001" },
              head_office: { address: { country: "FR" } },
            });
            const existing = await stripe.tax.registrations.list({ status: "active", limit: 100 });
            if (!existing.data.some((r: any) => r.country === "FR")) {
              await stripe.tax.registrations.create({
                country: "FR",
                country_options: { fr: { standard: { place_of_supply_scheme: "standard" }, type: "standard" } },
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
