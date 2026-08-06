// Раздел «Вопросы учеников»: что спрашивают у нейро-куратора.
// Открывается по ссылке из основной админки: /api/ts-admin-questions?key=ТВОЙ_КЛЮЧ
// Фильтры в адресе: &esc=1 только эскалации, &unworked=1 только непроработанные, &lesson=6 по уроку
// Выгрузка: &export=1 отдаёт CSV по текущему фильтру
// Переменные окружения те же, что у ts-admin: TS_ADMIN_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE
//
// Зачем: вопросы учеников это карта дыр в уроках и готовые темы для контента.
// Жёлтые строки это эскалации без проработки, по ним человек ждёт ответа в чате.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

// Похоже ли сообщение на контакт: ник телеграма, ссылка, номер телефона или слово-маркер
const looksLikeContact = (s) =>
  /@[a-zA-Z0-9_]{4,}|t\.me\/|wa\.me\/|телеграм|telegram|ватсап|whatsapp|вотсап|(^|[^а-яёa-z])тг([^а-яёa-z]|$)/i.test(String(s || "")) ||
  /(?:\+?\d[\s\-()]?){7,}/.test(String(s || ""));

export default async function handler(req, res) {
  const key = req.query?.key || "";
  if (!process.env.TS_ADMIN_KEY || key !== process.env.TS_ADMIN_KEY) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send("<p style='font-family:sans-serif'>Неверный ключ.</p>");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  const sb = (pathAndQuery, opts = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      ...opts,
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

  try {
    // Кнопка «пометить проработанным»
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.action === "work" && /^[0-9a-f-]{36}$/.test(String(body.id || ""))) {
        await sb(`ts_assistant_messages?id=eq.${body.id}`, {
          method: "PATCH",
          body: JSON.stringify({ worked: true }),
        });
        res.setHeader("Content-Type", "application/json");
        return res.status(200).send(JSON.stringify({ ok: true }));
      }
      return res.status(400).send("bad request");
    }

    // Режим «Лиды из чата»: гости и зарегистрированные без оплаты, сгруппированные по людям
    if (req.query?.leads === "1") {
      const rm = await sb(
        `ts_assistant_messages?role=eq.user&order=created_at.desc&limit=1000&select=user_email,content,lesson,sub,escalated,created_at`
      );
      const msgs = (await rm.json()) || [];
      const rp = await sb(`ts_payments?paid=eq.true&select=email`);
      const paidRows = (await rp.json()) || [];
      const paidSet = new Set((Array.isArray(paidRows) ? paidRows : []).map((x) => x.email));

      const people = {};
      for (const m of (Array.isArray(msgs) ? msgs : [])) {
        if (paidSet.has(m.user_email)) continue; // оплатившие не лиды
        const p = people[m.user_email] || (people[m.user_email] = {
          email: m.user_email, count: 0, last: m, contact: null, escalated: false,
        });
        p.count++;
        if (!p.contact && looksLikeContact(m.content)) p.contact = m.content;
        if (m.escalated) p.escalated = true;
      }
      const leads = Object.values(people);
      for (const p of leads) p.hot = !!(p.contact || p.escalated);
      leads.sort((a, b) => (b.hot - a.hot) || (new Date(b.last.created_at) - new Date(a.last.created_at)));
      const hotCount = leads.filter((p) => p.hot).length;

      const who = (e) => /^guest_/.test(e) ? `гость ${esc(e.slice(6, 10))}` : esc(e);
      const leadRows = leads.map((p) => `
        <tr${p.hot ? ' class="hot"' : ""}>
          <td>${p.hot ? "🔥 горячий" : "🌡 тёплый"}</td>
          <td>${who(p.email)}</td>
          <td class="q">${p.contact ? `<b>${esc(p.contact)}</b>` : '<span style="color:#999">не оставлен</span>'}</td>
          <td style="text-align:center">${p.count}</td>
          <td class="q">${esc(String(p.last.content || "").slice(0, 120))}</td>
          <td style="white-space:nowrap;color:#666">${esc(String(p.last.created_at || "").slice(0, 16).replace("T", " "))}</td>
        </tr>`).join("");

      const leadsHtml = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Target School · лиды из чата</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 1060px; margin: 0 auto; }
  h1 { font-size: 20px; }
  a { color: #1C1C1E; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; vertical-align: top; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  tr.hot { background: #FFF3E8; }
  td.q { max-width: 320px; }
  .count { color: #666; margin-bottom: 16px; }
  .tools { margin: 6px 0 16px; font-size: 13px; }
</style></head>
<body>
  <h1>Лиды из чата</h1>
  <div class="tools"><a href="/api/ts-admin-questions?key=${esc(req.query?.key || "")}">← к вопросам</a> · <a href="/api/ts-admin?key=${esc(req.query?.key || "")}">в админку</a></div>
  <div class="count">Горячие оставили контакт или позвали Анастасию, им пишем первым. Тёплые пока только спрашивают. Всего: ${leads.length}, горячих: <b>${hotCount}</b></div>
  <table>
    <thead><tr><th>Температура</th><th>Кто</th><th>Контакт</th><th>Вопросов</th><th>Последний вопрос</th><th>Когда</th></tr></thead>
    <tbody>${leadRows || "<tr><td colspan='6'>Пока пусто</td></tr>"}</tbody>
  </table>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(leadsHtml);
    }

    // Фильтры
    let filter = "role=eq.user";
    const fEsc = req.query?.esc === "1";
    const fUnworked = req.query?.unworked === "1";
    const fLesson = parseInt(req.query?.lesson, 10);
    if (fEsc) filter += "&escalated=eq.true";
    if (fUnworked) filter += "&worked=eq.false";
    if (Number.isInteger(fLesson) && fLesson > 0) filter += `&lesson=eq.${fLesson}`;

    const r = await sb(
      `ts_assistant_messages?${filter}&order=created_at.desc&limit=300&select=id,user_email,content,lesson,sub,escalated,worked,created_at`
    );
    const questions = (await r.json()) || [];
    const list = Array.isArray(questions) ? questions : [];

    // Ответы ассистента за тот же период, матчим по почте и минуте
    let answers = [];
    if (list.length) {
      const oldest = list[list.length - 1].created_at;
      const ra = await sb(
        `ts_assistant_messages?role=eq.assistant&created_at=gte.${encodeURIComponent(oldest)}&order=created_at.asc&limit=600&select=user_email,content,created_at`
      );
      const aRows = await ra.json();
      answers = Array.isArray(aRows) ? aRows : [];
    }
    const answerFor = (msg) => {
      const t = new Date(msg.created_at).getTime();
      const a = answers.find(
        (x) => x.user_email === msg.user_email &&
          new Date(x.created_at).getTime() >= t - 1000 &&
          new Date(x.created_at).getTime() - t < 60000
      );
      return a ? a.content : "";
    };

    // CSV по текущему фильтру
    if (req.query?.export === "1") {
      const head = ["date", "email", "lesson", "sub", "escalated", "worked", "question", "answer"];
      const lines = list.map((m) => [m.created_at, m.user_email, m.lesson, m.sub, m.escalated, m.worked, m.content, answerFor(m)]);
      const csv = [head, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ts-questions-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send("\uFEFF" + csv);
    }

    // Счётчики: сегодня, за неделю, эскалации без проработки
    const countWhere = async (extra) => {
      const rc = await sb(`ts_assistant_messages?role=eq.user${extra}&select=id`, {
        method: "HEAD",
        headers: { Prefer: "count=exact" },
      });
      const total = parseInt((rc.headers.get("content-range") || "").split("/")[1], 10);
      return Number.isFinite(total) ? total : 0;
    };
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [today, week, escOpen] = await Promise.all([
      countWhere(`&created_at=gte.${dayStart.toISOString()}`),
      countWhere(`&created_at=gte.${weekStart.toISOString()}`),
      countWhere("&escalated=eq.true&worked=eq.false"),
    ]);

    const mkUrl = (params) => {
      const p = new URLSearchParams({ key });
      for (const [k, v] of Object.entries(params)) if (v) p.set(k, String(v));
      return `/api/ts-admin-questions?${p.toString()}`;
    };

    const rowsHtml = list.map((m) => {
      const a = answerFor(m);
      const hot = m.escalated && !m.worked;
      return `
      <tr${hot ? ' class="hot"' : ""}>
        <td style="white-space:nowrap">${esc(String(m.created_at || "").slice(0, 16).replace("T", " "))}</td>
        <td>${esc(m.user_email)}</td>
        <td style="text-align:center">${m.lesson}.${m.sub}</td>
        <td class="q">${esc(m.content)}
          ${a ? `<details><summary>ответ ассистента</summary><div class="a">${esc(a)}</div></details>` : ""}
        </td>
        <td style="text-align:center">${m.escalated ? "🔔" : ""}</td>
        <td style="text-align:center">${
          m.worked ? "✓" : `<button class="work-btn" data-id="${esc(m.id)}">пометить</button>`
        }</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Target School · вопросы учеников</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 1060px; margin: 0 auto; }
  h1 { font-size: 20px; }
  a { color: #1C1C1E; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; vertical-align: top; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  tr.hot { background: #FFF8D6; }
  .count { color: #666; margin-bottom: 16px; }
  .tools { margin: 6px 0 16px; font-size: 13px; }
  td.q { max-width: 460px; }
  td.q details { margin-top: 6px; }
  td.q summary { cursor: pointer; color: #888; font-size: 12px; }
  td.q .a { color: #555; font-size: 13px; white-space: pre-wrap; margin-top: 4px; }
  .work-btn { background: #1C1C1E; color: #fff; border: none; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
</style></head>
<body>
  <h1>Вопросы учеников</h1>
  <div class="tools"><a href="/api/ts-admin?key=${esc(key)}">← назад в админку</a></div>

  <div class="count">
    Сегодня: <b>${today}</b>. За неделю: <b>${week}</b>. Эскалаций без проработки: <b style="color:${escOpen ? "#B3261E" : "#1C1C1E"}">${escOpen}</b>
  </div>

  <div class="tools">
    <a href="${mkUrl({})}">все</a> ·
    <a href="${mkUrl({ esc: "1" })}">только эскалации</a> ·
    <a href="${mkUrl({ unworked: "1" })}">только непроработанные</a> ·
    урок: ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<a href="${mkUrl({ lesson: n })}">${n}</a>`).join(" ")} ·
    <a href="${mkUrl({ esc: fEsc ? "1" : "", unworked: fUnworked ? "1" : "", lesson: Number.isInteger(fLesson) ? fLesson : "", export: "1" })}">скачать CSV</a> ·
    <a href="${mkUrl({ leads: "1" })}"><b>Лиды из чата 🔥</b></a>
  </div>

  <table>
    <thead><tr><th>Дата</th><th>Почта</th><th>Урок</th><th>Вопрос</th><th>Эск.</th><th></th></tr></thead>
    <tbody>${rowsHtml || "<tr><td colspan='6'>Пока пусто</td></tr>"}</tbody>
  </table>

  <script>
    document.querySelectorAll('.work-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        fetch(location.pathname + '?key=' + encodeURIComponent(new URLSearchParams(location.search).get('key') || ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'work', id: btn.getAttribute('data-id') })
        }).then(function (r) { if (r.ok) btn.outerHTML = '✓'; });
      });
    });
  </script>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>Ошибка: " + esc(String(e)) + "</p>");
  }
}
