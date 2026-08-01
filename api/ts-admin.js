// Минимальная админка. Показывает оплативших и отдельно тех, кто зарегистрировался,
// но не оплатил (с ними можно списаться, если оставили телеграм).
// Позволяет вручную открыть или убрать доступ по почте.
// Открывается по ссылке с секретным ключом: /api/ts-admin?key=ТВОЙ_КЛЮЧ
// Переменные окружения:
//   TS_ADMIN_KEY           — свой секретный ключ, придумай любой длинный пароль
//   SUPABASE_URL           — тот же URL проекта Supabase
//   SUPABASE_SERVICE_ROLE  — service_role ключ (секретный)
//
// Важно: тут видно, КТО оплатил и КОГДА. На каком уроке сейчас человек, эта страница
// не покажет, прогресс по урокам хранится в браузере самого человека, не в базе.
// Доступ на месяц не отключается автоматически, продления пока ручные: смотри колонку
// "Доступ до" и списывайся с человеком заранее.

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const key = req.query?.key || "";
  if (!process.env.TS_ADMIN_KEY || key !== process.env.TS_ADMIN_KEY) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send("<p style='font-family:sans-serif'>Неверный ключ.</p>");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  let message = "";

  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const email = (body.email || "").trim().toLowerCase();
      const action = body.action === "revoke" ? "revoke" : "grant";
      if (email) {
        const payload = action === "grant"
          ? {
              email,
              paid: true,
              amount: body.amount ? Number(body.amount) : 1490,
              currency: "RUB",
              paid_at: new Date().toISOString(),
            }
          : { email, paid: false, paid_at: null };

        const up = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
          method: "POST",
          headers: {
            apikey: SERVICE,
            Authorization: `Bearer ${SERVICE}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(payload),
        });

        if (action === "grant") {
          message = up.ok
            ? `Готово. Доступ открыт для ${email}. Когда человек войдёт под этой почтой, платные уроки откроются.`
            : `Не получилось: ${await up.text()}`;
        } else {
          message = up.ok
            ? `Готово. Доступ убран у ${email}. При следующем входе платные уроки снова закроются.`
            : `Не получилось: ${await up.text()}`;
        }
      }
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?select=email,paid,amount,currency,paid_at,created_at,telegram&order=created_at.desc`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const rows = await r.json();
    const all = Array.isArray(rows) ? rows : [];
    const paidRows = all.filter((x) => x.paid);
    const unpaidRows = all.filter((x) => !x.paid);

    const revokeForm = (email) => `
      <form method="POST" action="?key=${key}" style="display:inline">
        <input type="hidden" name="email" value="${email}" />
        <input type="hidden" name="action" value="revoke" />
        <button type="submit" class="link-btn" onclick="return confirm('Убрать доступ у ${email}?')">убрать доступ</button>
      </form>`;

    const paidRowsHtml = paidRows.map((x) => {
      const until = x.paid_at ? new Date(new Date(x.paid_at).getTime() + 30 * DAY_MS) : null;
      return `
      <tr>
        <td>${x.email || ""}</td>
        <td>${x.telegram ? x.telegram : "—"}</td>
        <td>${x.amount ?? ""} ${x.currency ?? ""}</td>
        <td>${x.paid_at ? new Date(x.paid_at).toLocaleDateString("ru") : ""}</td>
        <td>${until ? until.toLocaleDateString("ru") : ""}</td>
        <td>${revokeForm(x.email)}</td>
      </tr>`;
    }).join("");

    const unpaidRowsHtml = unpaidRows.map((x) => `
      <tr>
        <td>${x.email || ""}</td>
        <td>${x.telegram ? x.telegram : "—"}</td>
        <td>${x.created_at ? new Date(x.created_at).toLocaleDateString("ru") : ""}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<title>Target School · оплатившие</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  .count { color: #666; margin-bottom: 16px; }
  .box { background: #fff; border-radius: 12px; padding: 16px; }
  .box input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #E0E0E0; border-radius: 8px; font-size: 14px; margin-bottom: 10px; }
  .box button { background: #1C1C1E; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
  .msg { background: #EFF9F0; border: 1px solid #B7E4BC; color: #1B7F3B; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .msg.err { background: #FDEEEE; border-color: #F0B8B8; color: #B3261E; }
  .link-btn { background: none; border: none; color: #B3261E; text-decoration: underline; cursor: pointer; font-size: 13px; padding: 0; }
</style></head>
<body>
  <h1>Target School · админка</h1>

  ${message ? `<div class="msg ${message.startsWith("Не получилось") ? "err" : ""}">${message}</div>` : ""}

  <h2>ОТКРЫТЬ ДОСТУП ВРУЧНУЮ</h2>
  <div class="box">
    <form method="POST" action="?key=${key}">
      <input type="hidden" name="action" value="grant" />
      <input type="email" name="email" placeholder="Почта человека" required />
      <button type="submit">Открыть доступ</button>
    </form>
  </div>

  <h2>ОПЛАТИЛИ</h2>
  <div class="count">Всего: ${paidRows.length}</div>
  <table>
    <tr><th>Почта</th><th>Телеграм</th><th>Сумма</th><th>Оплатил</th><th>Доступ до</th><th></th></tr>
    ${paidRowsHtml || "<tr><td colspan='6'>Пока пусто</td></tr>"}
  </table>

  <h2>ЗАРЕГИСТРИРОВАЛИСЬ, НЕ ОПЛАТИЛИ</h2>
  <div class="count">Всего: ${unpaidRows.length}. Можно написать, если оставили телеграм.</div>
  <table>
    <tr><th>Почта</th><th>Телеграм</th><th>Когда зарегистрировался</th></tr>
    ${unpaidRowsHtml || "<tr><td colspan='3'>Пока пусто</td></tr>"}
  </table>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>Ошибка: " + String(e) + "</p>");
  }
}
