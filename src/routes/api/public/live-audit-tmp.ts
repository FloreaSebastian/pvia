/**
 * TEMPORAIRE — audit lecture seule de la configuration Stripe LIVE.
 * Protégé par CRON_SECRET. À supprimer après le gate de production.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createStripeClient } from "@/lib/stripe.server";

export const Route = createFileRoute("/api/public/live-audit-tmp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { secret?: string; action?: string; args?: any };
        if (!process.env.CRON_SECRET || body.secret !== process.env.CRON_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
        const out: any = {};
        try {
          if (body.action === "env") {
            const flag = (v?: string) => (v ? "CONFIGURÉ" : "MANQUANT");
            out.env = {
              APP_ENV: process.env.APP_ENV ?? null,
              PUBLIC_APP_URL: process.env.PUBLIC_APP_URL ?? null,
              STRIPE_LIVE_API_KEY: flag(process.env.STRIPE_LIVE_API_KEY),
              STRIPE_SANDBOX_API_KEY: flag(process.env.STRIPE_SANDBOX_API_KEY),
              PAYMENTS_LIVE_WEBHOOK_SECRET: process.env.PAYMENTS_LIVE_WEBHOOK_SECRET
                ? process.env.PAYMENTS_LIVE_WEBHOOK_SECRET.startsWith("whsec_")
                  ? "CONFIGURÉ"
                  : "INCOHÉRENT"
                : "MANQUANT",
              PAYMENTS_SANDBOX_WEBHOOK_SECRET: process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET
                ? process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET.startsWith("whsec_")
                  ? "CONFIGURÉ"
                  : "INCOHÉRENT"
                : "MANQUANT",
            };
            return Response.json(out);
          }

          const env = body.args?.env === "sandbox" ? "sandbox" : "live";
          const stripe = createStripeClient(env);

          if (body.action === "prices") {
            const keys = [
              "starter_monthly",
              "starter_annual",
              "pro_monthly",
              "pro_annual",
              "business_monthly",
              "business_annual",
            ];
            const prices = await stripe.prices.list({ lookup_keys: keys, limit: 20, expand: ["data.product"] });
            out.prices = prices.data.map((p: any) => ({
              lookup_key: p.lookup_key,
              id_prefix: String(p.id).slice(0, 8),
              livemode: p.livemode,
              currency: p.currency,
              unit_amount: p.unit_amount,
              interval: p.recurring?.interval,
              tax_behavior: p.tax_behavior,
              active: p.active,
              product_name: p.product?.name,
              product_active: p.product?.active,
              product_tax_code: p.product?.tax_code,
            }));
            out.missing = keys.filter((k) => !prices.data.some((p: any) => p.lookup_key === k));
          }

          if (body.action === "tax") {
            const regs = await (stripe as any).tax.registrations.list({ limit: 100 });
            out.registrations = regs.data.map((r: any) => ({
              country: r.country,
              status: r.status,
              type: r.country_options?.[r.country?.toLowerCase()]?.type ?? null,
              livemode: r.livemode,
            }));
            const settings = await (stripe as any).tax.settings.retrieve();
            out.taxSettings = {
              status: settings.status,
              defaults: settings.defaults,
              head_office_country: settings.head_office?.address?.country ?? null,
              livemode: settings.livemode,
            };
          }

          if (body.action === "webhooks") {
            const eps = await stripe.webhookEndpoints.list({ limit: 30 });
            out.endpoints = eps.data.map((e: any) => ({
              url: e.url,
              status: e.status,
              livemode: e.livemode,
              api_version: e.api_version,
              enabled_events: e.enabled_events,
            }));
          }

          if (body.action === "account") {
            const acct = await stripe.accounts.retrieve();
            out.account = {
              id: acct.id,
              country: acct.country,
              charges_enabled: (acct as any).charges_enabled,
              payouts_enabled: (acct as any).payouts_enabled,
              default_currency: (acct as any).default_currency,
              business_name: (acct as any).business_profile?.name ?? null,
              support_email: (acct as any).business_profile?.support_email ?? null,
              url: (acct as any).business_profile?.url ?? null,
            };
          }

          if (body.action === "customer") {
            const c = await stripe.customers.retrieve(body.args.customerId, {
              expand: ["subscriptions"],
            });
            out.customer = c;
          }

          if (body.action === "session") {
            const s = await stripe.checkout.sessions.retrieve(body.args.sessionId, {
              expand: ["line_items", "subscription", "invoice", "total_details"],
            });
            out.session = s;
          }

          if (body.action === "invoices") {
            const inv = await stripe.invoices.list({ customer: body.args.customerId, limit: 10 });
            out.invoices = inv.data.map((i: any) => ({
              id: i.id,
              number: i.number,
              status: i.status,
              livemode: i.livemode,
              subtotal: i.subtotal,
              tax: i.tax ?? i.total_taxes?.[0]?.amount,
              total: i.total,
              currency: i.currency,
              created: i.created,
              pdf: !!i.invoice_pdf,
              hosted: !!i.hosted_invoice_url,
              customer_name: i.customer_name,
              account_name: i.account_name,
            }));
          }

          if (body.action === "events") {
            const evs = await stripe.events.list({ limit: Number(body.args?.limit ?? 25) });
            out.events = evs.data.map((e: any) => ({
              id: e.id,
              type: e.type,
              livemode: e.livemode,
              created: e.created,
            }));
          }

          return Response.json(out);
        } catch (e: any) {
          return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
