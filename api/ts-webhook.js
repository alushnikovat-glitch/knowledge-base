// Vercel serverless function: принимает вебхук об оплате от LavaTop
// и помечает человека оплатившим в таблице ts_payments (Supabase).
// Пишет через service_role, поэтому ключ секретный, только в Vercel.
// Переменные окружения:
//   SUPABASE_URL           — тот же URL проекта Supabase
//   SUPABASE_SERVICE_ROLE  — service_role ключ (секретный)
//   LAVA_WEBHOOK_SECRET    — (опционально) секрет проверки. Пусто = проверка спит.
//                            Когда заведёшь секрет в LavaTop (поле Api key вебхука)
//                            и сюда, вебхук начнёт принимать только подписанные запросы.
//   META_PIXEL_ID          — ID пикселя Meta. Пусто = сигнал в Meta не шлём
//   META_CAPI_TOKEN        — токен Conversions API, секретный
//
// Событие Purchase уходит в Meta с опознавательными данными для сопоставления:
// хеш почты плюс, если регистрация их поймала, куки пикселя (_fbp, _fbc),
// айпи и браузер человека из колонок fbp/fbc/reg_ip/reg_ua.
// Колонок может не быть, тогда уходит только хеш почты, как раньше.
//
// Дверь продажи: запись получает source = "lavatop" для колонки «Откуда» в админке.
// Если колонки source в базе нет, запись повторяется без неё, оплата не потеряется.

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    // Спящая проверка подписи: включается только когда секрет задан в окружении
    if (process.env.LAVA_WEBHOOK_SECRET) {
      const got = String(req.headers["x-api-key"] || req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      if (got !== process.env.LAVA_WEBHOOK_SECRET) {
        console.log("TS-WEBHOOK REJECTED", "подпись не совпала");
        return res.status(401).json({ error: "bad signature" });
      }
    }

    const event = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    console.log("TS-WEBHOOK RAW BODY", JSON.stringify(event));

    const email = (event.buyer?.email || event.email || "").trim().toLowerCase();
    const status = String(event.status || event.eventType || event.event || "").toLowerCase();
    const paidMarkers = ["completed", "paid", "success", "active", "subscription-active"];
    const isPaid = paidMarkers.some((m) => status.includes(m));

    console.log("TS-WEBHOOK PARSED", JSON.stringify({ email, status, isPaid }));

    if (!email || !isPaid) {
      console.log("TS-WEBHOOK SKIPPED", JSON.stringify({ reason: "no email or not paid", email, status }));
      return res.status(200).json({ ok: true, skipped: true, reason: "no email or not paid", status });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
    const amount = event.amount || 1490;
    const currency = event.currency || "RUB";
    const invoiceId = event.id || event.invoiceId || event.invoice_id || null;

    const upsert = (payload) =>
      fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
        method: "POST",
        headers: {
          apikey: SERVICE,
          Authorization: `Bearer ${SERVICE}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(payload),
      });

    const basePayload = {
      email,
      paid: true,
      offer_id: event.offerId || event.offer_id || null,
      amount,
      currency,
      invoice_id: invoiceId,
      paid_at: new Date().toISOString(),
    };

    // Пробуем с меткой двери. Если колонки source нет, повторяем без неё.
    let r = await upsert({ ...basePayload, source: "lavatop" });
    if (!r.ok) {
      const detail = await r.text();
      if (/source/i.test(detail)) {
        console.log("TS-WEBHOOK SOURCE COLUMN MISSING", "пишу без метки двери");
        r = await upsert(basePayload);
      }
      if (!r.ok) {
        const detail2 = await r.text();
        console.log("TS-WEBHOOK SUPABASE FAILED", r.status, detail2);
        return res.status(500).json({ error: "supabase upsert failed", detail: detail2 });
      }
    }

    console.log("TS-WEBHOOK PAID OK", email);

    if (process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN) {
      try {
        // Забираем опознавательные данные, пойманные при регистрации
        let match = {};
        try {
          const rowRes = await fetch(
            `${SUPABASE_URL}/rest/v1/ts_payments?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
            { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
          );
          const rows = await rowRes.json();
          if (Array.isArray(rows) && rows[0]) match = rows[0];
        } catch (e) {
          console.log("TS-WEBHOOK MATCH FETCH SKIP", String(e));
        }

        const hashedEmail = crypto.createHash("sha256").update(email).digest("hex");
        const userData = { em: [hashedEmail] };
        if (match.fbp) userData.fbp = match.fbp;
        if (match.fbc) userData.fbc = match.fbc;
        if (match.reg_ip) userData.client_ip_address = match.reg_ip;
        if (match.reg_ua) userData.client_user_agent = match.reg_ua;

        const metaRes = await fetch(`https://graph.facebook.com/v23.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_CAPI_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: [{
              event_name: "Purchase",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              event_source_url: "https://www.anastasialushnikova.com/trenazher/",
              event_id: invoiceId || undefined,
              user_data: userData,
              custom_data: { value: Number(amount), currency },
            }],
          }),
        });
        const metaText = await metaRes.text();
        console.log("TS-WEBHOOK META CAPI", metaRes.status, metaText);
      } catch (e) {
        console.log("TS-WEBHOOK META CAPI ERROR", String(e));
      }
    } else {
      console.log("TS-WEBHOOK META CAPI SKIPPED", "нет META_PIXEL_ID или META_CAPI_TOKEN в окружении");
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
