// Временная диагностическая функция. Показывает список продуктов LavaTop с их настоящими offer_id.
// Открывается прямо в браузере как обычная страница, ничего никуда не отправляет и не меняет.
// Удалить после того, как найдём нужный offer_id и пропишем его в LAVA_OFFER_ID.

export default async function handler(req, res) {
    try {
          const r = await fetch("https://gate.lava.top/api/v2/products?feedVisibility=ALL&showAllSubscriptionPeriods=true", {
                  headers: { "X-Api-Key": process.env.LAVA_API_KEY },
          });
          const text = await r.text();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.status(200).send(text);
    } catch (e) {
          res.status(500).json({ error: String(e) });
    }
}
