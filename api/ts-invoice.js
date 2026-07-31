// Vercel serverless function: создаёт инвойс в LavaTop.
// Секретный ключ X-Api-Key живёт в переменных окружения Vercel, не в панели.
// Переменные окружения (Vercel → Settings → Environment Variables):
//   LAVA_API_KEY   — X-Api-Key из LavaTop
//   LAVA_OFFER_ID  — id продукта 1490 (можно и из тела запроса)

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

    console.log("TS-INVOICE REQUEST", JSON.stringify({ email, offerId, currency, buyerLanguage, hasKey: !!process.env.LAVA_API_KEY }));

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

    const rawText = await r.text();
    console.log("TS-INVOICE LAVA RESPONSE", r.status, rawText);

    let data = {};
    try { data = JSON.parse(rawText); } catch (e) { data = { raw: rawText }; }

    if (!r.ok) {
      return res.status(r.status).json({ error: "lava error", detail: data });
    }

    const paymentUrl = data.paymentUrl || data.url || data.paymentLink || data.link;
    return res.status(200).json({ paymentUrl, raw: data });
  } catch (e) {
    console.error("TS-INVOICE ERROR", e);
    return res.status(500).json({ error: String(e) });
  }
}
