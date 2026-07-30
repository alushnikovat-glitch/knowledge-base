export default async function handler(req, res) {
    if (req.method !== "POST") {
          return res.status(405).json({ error: "Method not allowed" });
    }
    try {
          const event = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
          const email = (event.buyer?.email || event.email || "").trim().toLowerCase();
          const status = String(event.status || event.eventType || event.event || "").toLowerCase();
          const paidMarkers = ["completed", "paid", "success", "active", "subscription-active"];
          const isPaid = paidMarkers.some((m) => status.includes(m));

      if (!email || !isPaid) {
              return res.status(200).json({ ok: true, skipped: true, status });
      }

      const SUPABASE_URL = process.env.SUPABASE_URL;
          const SERVICE = process.env.SUPABASE_SERVICE_ROLE;

      const r = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
              method: "POST",
              headers: {
                        apikey: SERVICE,
                        Authorization: `Bearer ${SERVICE}`,
                        "Content-Type": "application/json",
                        Prefer: "resolution=merge-duplicates",
              },
              body: JSON.stringify({
                        email,
                        paid: true,
                        offer_id: event.offerId || event.offer_id || null,
                        amount: event.amount || null,
                        currency: event.currency || null,
                        invoice_id: event.id || event.invoiceId || event.invoice_id || null,
                        paid_at: new Date().toISOString(),
              }),
      });

      if (!r.ok) {
              const detail = await r.text();
              return res.status(500).json({ error: "supabase upsert failed", detail });
      }
          return res.status(200).json({ ok: true });
    } catch (e) {
          return res.status(500).json({ error: String(e) });
    }
}
