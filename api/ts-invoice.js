export default async function handler(req, res) {
    if (req.method !== "POST") {
          return res.status(405).json({ error: "Method not allowed" });
    }
    try {
          const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
          const email = (body.email || "").trim().toLowerCase();
          const offerId = body.offerId || process.env.LAVA_OFFER_ID;
          const currency = body.currency || "RUB";
          const buyerLanguage = body.buyerLanguage || "ru";

      if (!email) return res.status(400).json({ error: "email required" });
          if (!offerId) return res.status(400).json({ error: "offerId required" });

      const r = await fetch("https://gate.lava.top/api/v2/invoice", {
              method: "POST",
              headers: {
                        "X-Api-Key": process.env.LAVA_API_KEY,
                        "Content-Type": "application/json",
              },
              body: JSON.stringify({ email, offerId, currency, buyerLanguage }),
      });

      const data = await r.json().catch(() => ({}));
          if (!r.ok) return res.status(r.status).json({ error: "lava error", detail: data });

      const paymentUrl = data.paymentUrl || data.url || data.paymentLink || data.link;
          return res.status(200).json({ paymentUrl, raw: data });
    } catch (e) {
          return res.status(500).json({ error: String(e) });
    }
}
