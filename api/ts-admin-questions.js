// Раздел «Вопросы учеников»: диалоги с нейро-куратором в виде входящих.
// /api/ts-admin-questions?key=КЛЮЧ            — список диалогов (как входящие в Instagram)
// &dialog=ПОЧТА_ИЛИ_ГОСТЬ                     — вся переписка одного человека
// &leads=1                                    — лиды из чата (горячие и тёплые)
// &export=1                                   — CSV всех вопросов
// POST { action: "work", id }                 — пометить сообщение проработанным
// Переменные окружения те же, что у ts-admin: TS_ADMIN_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

// Похоже ли сообщение на контакт: ник телеграма, ссылка, номер телефона или слово-маркер
const looksLikeContact = (s) =>
  /@[a-zA-Z0-9_]{4,}|t\.me\/|wa\.me\/|телеграм|telegram|ватсап|whatsapp|вотсап|(^|[^а-яёa-z])тг([^а-яёa-z]|$)/i.test(String(s || "")) ||
  /(?:\+?\d[\s\-()]?){7,}/.test(String(s || ""));

const TS_SCRIPT = `<script>
  document.querySelectorAll('.ts').forEach(function (el) {
    var t = el.getAttribute('data-t');
    if (!t) return;
    var d = new Date(t);
    if (isNaN(d)) return;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    el.textContent = p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  });
</script>`;

const BASE_CSS = `
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 860px; margin: 0 auto; }
  h1 { font-size: 20px; }
  a { color: #1C1C1E; }

  .btn-link { display: inline-block; background: #fff; border: 1px solid #E0E0E0; border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 700; color: #1C1C1E; text-decoration: none; margin: 0 8px 8px 0; }
  .btn-link.accent { background: #FFF3E8; border-color: #F5C79A; color: #A05A00; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; margin: 6px 0 16px; }
  .count { color: #666; margin-bottom: 16px; font-size: 14px; }`;

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

  const who = (e) => /^guest_/.test(e) ? `гость ${esc(String(e).slice(6, 10))}` : esc(e);

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
      // Обработка человека целиком: гасит все его колокольчики разом
      if (body.action === "work_person") {
        const pe = String(body.email || "").trim().toLowerCase();
        const okId = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pe) || /^guest_[a-z0-9]{6,16}$/.test(pe);
        if (okId) {
          await sb(`ts_assistant_messages?user_email=eq.${encodeURIComponent(pe)}&escalated=eq.true&worked=eq.false`, {
            method: "PATCH",
            body: JSON.stringify({ worked: true }),
          });
          res.setHeader("Content-Type", "application/json");
          return res.status(200).send(JSON.stringify({ ok: true }));
        }
      }
      return res.status(400).send("bad request");
    }

    // Режим «Ответы анкеты»: точка старта и момент честности из урока 1.
    // Раньше жил отдельным файлом ts-goals-admin.js, перенесён сюда 12 августа,
    // чтобы уложиться в лимит 12 серверных функций на бесплатном тарифе Vercel.
    if (req.query?.goals === "1") {
      const TZ_OFFSET_H = 7;
      const SITUATION_RU = { decree: "Декрет", office: "Надоел найм", studied: "Уже училась", relocate: "Переезд", own: "Своё дело" };
      const GOAL_RU = { "50000": "50 000 ₽", "100000": "100 000 ₽", "150000": "150 000 ₽+", unsure: "Пока не знает" };
      const AI_RU = { yes: "Пользовалась", no: "Ни разу" };
      const localTime = (iso) => {
        if (!iso) return "";
        const d = new Date(new Date(iso).getTime() + TZ_OFFSET_H * 3600 * 1000);
        const p = (n) => String(n).padStart(2, "0");
        return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
      };
      const countBy = (rows, field, dict) => {
        const out = {};
        for (const r of rows) { const v = r[field]; if (!v) continue; out[v] = (out[v] || 0) + 1; }
        return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: (dict && dict[k]) || k, n }));
      };

      const rg = await sb(`ts_goals?select=*&order=updated_at.desc&limit=1000`);
      const rows = (await rg.json()) || [];
      const list = Array.isArray(rows) ? rows : [];

      if (req.query?.csv === "1") {
        const head = ["sid", "niche", "situation", "goal_sum", "ai_exp", "commitment", "email", "created_at", "updated_at"];
        const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
        const csv = [head.join(";")].concat(list.map((r) => head.map((h) => cell(r[h])).join(";"))).join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="ts_goals_${Date.now()}.csv"`);
        return res.status(200).send("\uFEFF" + csv);
      }

      const total = list.length;
      const withCommit = list.filter((r) => r.commitment && r.commitment.trim()).length;
      const withEmail = list.filter((r) => r.email).length;
      const bySituation = countBy(list, "situation", SITUATION_RU);
      const byGoal = countBy(list, "goal_sum", GOAL_RU);
      const byAi = countBy(list, "ai_exp", AI_RU);

      const statCard = (label, value, sub) => `
        <div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}</div>`;
      const distBlock = (title, items) => `
        <div class="gcard"><div class="gcard-title">${esc(title)}</div>${items.length === 0 ? '<div class="empty">Пока пусто</div>' : items.map((x) => `
          <div class="dist-row"><span>${esc(x.label)}</span><span class="dist-n">${x.n}<span class="dist-pct"> · ${total ? Math.round((x.n / total) * 100) : 0}%</span></span></div>`).join("")}</div>`;

      const feed = list.slice(0, 200).map((r) => `
        <div class="lead${r.email ? " lead-hot" : ""}">
          <div class="lead-top">
            <span class="tag">${esc(SITUATION_RU[r.situation] || "—")}</span>
            <span class="tag tag-goal">${esc(GOAL_RU[r.goal_sum] || "—")}</span>
            <span class="tag ${r.ai_exp === "no" ? "tag-new" : ""}">${esc(r.ai_exp ? "Нейросеть: " + AI_RU[r.ai_exp] : "")}</span>
            <span class="lead-time">${esc(localTime(r.updated_at))}</span>
          </div>
          ${r.niche ? `<div class="lead-niche">Ниша: ${esc(r.niche)}</div>` : ""}
          ${r.commitment ? `<div class="lead-commit">«${esc(r.commitment)}»</div>` : ""}
          ${r.email ? `<div class="lead-email">🔥 ${esc(r.email)}</div>` : ""}
        </div>`).join("");

      const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ответы учеников · Target School</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; background: #F5F5F7; color: #1D1D1F; padding: 18px; max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; letter-spacing: -0.02em; margin-bottom: 4px; }
  .sub { color: #86868B; font-size: 13px; margin-bottom: 16px; }
  .btn-link { display: inline-block; background: #fff; border: 1px solid #E0E0E0; border-radius: 10px; padding: 9px 16px; font-size: 13.5px; font-weight: 700; color: #1D1D1F; text-decoration: none; margin: 0 8px 8px 0; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; margin: 6px 0 14px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .stat { background: #fff; border-radius: 14px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  .stat-label { font-size: 11px; font-weight: 700; color: #86868B; letter-spacing: .03em; text-transform: uppercase; }
  .stat-value { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin-top: 2px; }
  .stat-sub { font-size: 12px; color: #86868B; margin-top: 2px; }
  .gcard { background: #fff; border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); margin-bottom: 12px; }
  .gcard-title { font-size: 12px; font-weight: 700; letter-spacing: .03em; color: #86868B; text-transform: uppercase; margin-bottom: 8px; }
  .dist-row { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid rgba(0,0,0,.06); font-size: 14px; }
  .dist-row:first-of-type { border-top: none; }
  .dist-n { font-weight: 700; }
  .dist-pct { color: #86868B; font-weight: 400; }
  .empty { color: #86868B; font-size: 14px; }
  .lead { background: #fff; border-radius: 14px; padding: 13px 15px; box-shadow: 0 1px 3px rgba(0,0,0,.05); margin-bottom: 10px; }
  .lead-hot { background: #FFF3E8; box-shadow: none; border: 1px solid #F5C79A; }
  .lead-top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { background: #F5F5F7; border-radius: 99px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
  .tag-goal { background: rgba(255,204,0,.25); }
  .tag-new { background: rgba(52,199,89,.15); color: #1B7F3B; }
  .lead-time { margin-left: auto; color: #86868B; font-size: 12px; }
  .lead-niche { font-size: 13px; color: #86868B; margin-top: 7px; }
  .lead-commit { font-size: 14.5px; line-height: 1.5; margin-top: 7px; font-style: italic; }
  .lead-email { font-size: 13px; font-weight: 700; margin-top: 7px; color: #1B7F3B; }
  h2 { font-size: 15px; margin: 18px 0 10px; letter-spacing: -0.01em; }
</style></head>
<body>
  <h1>Ответы учеников</h1>
  <div class="sub">Точка старта и момент честности из урока 1 · время местное (UTC+7) · показаны последние 200</div>
  <div class="tools">
    <a class="btn-link" href="/api/ts-admin?key=${esc(key)}">← в админку</a>
    <a class="btn-link" href="?key=${esc(key)}&goals=1&csv=1">Скачать всё таблицей (CSV)</a>
  </div>
  <div class="stats">
    ${statCard("Всего ответов", total)}
    ${statCard("С обязательством", withCommit, total ? Math.round((withCommit / total) * 100) + "% написали текст" : "")}
    ${statCard("С почтой", withEmail, "склеены с регистрацией")}
  </div>
  ${distBlock("Ситуации", bySituation)}
  ${distBlock("Цели через 3 месяца", byGoal)}
  ${distBlock("Опыт нейросетей", byAi)}
  <h2>Лента, свежие сверху</h2>
  ${feed || '<div class="gcard"><div class="empty">Ответов пока нет. Появятся после деплоя панели.</div></div>'}
</body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }

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
          <td><a href="/api/ts-admin-questions?key=${esc(req.query?.key || "")}&dialog=${encodeURIComponent(p.email)}">${who(p.email)}</a></td>
          <td class="q">${p.contact ? `<b>${esc(p.contact)}</b>` : '<span style="color:#999">не оставлен</span>'}</td>
          <td style="text-align:center">${p.count}</td>
          <td class="q">${esc(String(p.last.content || "").slice(0, 120))}</td>
          <td style="white-space:nowrap;color:#666" class="ts" data-t="${esc(p.last.created_at || "")}">${esc(String(p.last.created_at || "").slice(0, 16).replace("T", " "))}</td>
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

  .btn-link { display: inline-block; background: #fff; border: 1px solid #E0E0E0; border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 700; color: #1C1C1E; text-decoration: none; margin: 0 8px 8px 0; }
  .btn-link.accent { background: #FFF3E8; border-color: #F5C79A; color: #A05A00; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; margin: 6px 0 16px; }
</style></head>
<body>
  <h1>Лиды из чата</h1>
  <div class="tools"><a class="btn-link" href="/api/ts-admin-questions?key=${esc(req.query?.key || "")}">← к вопросам</a><a class="btn-link" href="/api/ts-admin?key=${esc(req.query?.key || "")}">В админку</a></div>
  <div class="count">Горячие оставили контакт или позвали Анастасию, им пишем первым. Тёплые пока только спрашивают. Всего: ${leads.length}, горячих: <b>${hotCount}</b></div>
  <table>
    <thead><tr><th>Температура</th><th>Кто</th><th>Контакт</th><th>Вопросов</th><th>Последний вопрос</th><th>Когда</th></tr></thead>
    <tbody>${leadRows || "<tr><td colspan='6'>Пока пусто</td></tr>"}</tbody>
  </table>
<script>
  document.querySelectorAll('.ts').forEach(function (el) {
    var t = el.getAttribute('data-t');
    if (!t) return;
    var d = new Date(t);
    if (isNaN(d)) return;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    el.textContent = p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  });
</script>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(leadsHtml);
    }


    // Переписка одного человека, как диалог в мессенджере
    const dialogWith = String(req.query?.dialog || "").trim().toLowerCase();
    if (dialogWith) {
      const r = await sb(
        `ts_assistant_messages?user_email=eq.${encodeURIComponent(dialogWith)}&order=created_at.asc&limit=300&select=id,role,content,lesson,sub,escalated,worked,created_at`
      );
      const rows = await r.json();
      const msgs = Array.isArray(rows) ? rows : [];

      const bubbles = msgs.map((m) => {
        const mine = m.role === "user";
        const contact = mine && looksLikeContact(m.content);
        const needWork = mine && m.escalated && !m.worked;
        const metaParts = [
          `<span class="ts" data-t="${esc(m.created_at)}">${esc(String(m.created_at || "").slice(0, 16).replace("T", " "))}</span>`,
        ];
        if (m.lesson) metaParts.push(`урок ${m.lesson}.${m.sub}`);
        if (contact) metaParts.push("🔥 контакт");
        if (mine && m.escalated && m.worked) metaParts.push("🔔 ✓");
        else if (m.escalated) metaParts.push("🔔");
        return `<div class="row ${mine ? "right" : "left"}"><div class="bubble ${mine ? "user" : "bot"} ${contact ? "contact" : ""}"><div class="txt">${esc(m.content)}</div><div class="meta">${metaParts.join(" · ")}</div></div></div>`;
      }).join("");

      const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Диалог · ${who(dialogWith)}</title>
<style>${BASE_CSS}
  body { max-width: 640px; }
  .thread { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; }
  .row.right { justify-content: flex-end; }
  .row.left { justify-content: flex-start; }
  .bubble { max-width: 82%; padding: 9px 13px; border-radius: 14px; }
  .bubble .txt { font-size: 15px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .bubble.user { background: #FFCC00; border-bottom-right-radius: 4px; }
  .bubble.bot { background: #fff; border: 1px solid #E8E8E8; border-bottom-left-radius: 4px; }
  .bubble.contact { outline: 2px solid #FF9500; }
  .meta { font-size: 11px; color: #8E8E93; margin-top: 5px; white-space: nowrap; }
  .work-btn { background: #1C1C1E; color: #fff; border: none; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
</style></head>
<body>
  <h1>${who(dialogWith)}
    ${msgs.some((m) => m.role === "user" && m.escalated && !m.worked)
      ? `<button id="work-person" data-e="${esc(dialogWith)}" style="float:right;background:#1C1C1E;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">взяла в работу</button>`
      : ""}
  </h1>
  <div class="tools"><a class="btn-link" href="/api/ts-admin-questions?key=${esc(key)}">← все диалоги</a><a class="btn-link" href="/api/ts-admin?key=${esc(key)}">В админку</a></div>
  <div class="thread">${bubbles || "<div class='count'>Сообщений нет</div>"}</div>
  ${TS_SCRIPT}
  <script>
    var wp = document.getElementById('work-person');
    if (wp) wp.addEventListener('click', function () {
      fetch(location.pathname + '?key=' + encodeURIComponent(new URLSearchParams(location.search).get('key') || ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'work_person', email: wp.getAttribute('data-e') })
      }).then(function (r) { if (r.ok) wp.outerHTML = '<span style="float:right;color:#1B7F3B;font-size:14px">✓ обработан</span>'; });
    });
  </script>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }

    // Все сообщения за последнее время: собираем диалоги
    const r = await sb(
      `ts_assistant_messages?order=created_at.desc&limit=1000&select=id,user_email,role,content,lesson,sub,escalated,worked,created_at`
    );
    const raw = await r.json();
    const msgs = Array.isArray(raw) ? raw : [];

    // CSV по вопросам
    if (req.query?.export === "1") {
      const head = ["date", "email", "role", "lesson", "sub", "escalated", "worked", "content"];
      const lines = msgs.map((m) => [m.created_at, m.user_email, m.role, m.lesson, m.sub, m.escalated, m.worked, m.content]);
      const csv = [head, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ts-dialogs-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send("\uFEFF" + csv);
    }

    // Кто ученица: оплатившие почты
    let paidSet = new Set();
    try {
      const rp = await sb(`ts_payments?paid=eq.true&select=email`);
      const paidRows = await rp.json();
      if (Array.isArray(paidRows)) paidSet = new Set(paidRows.map((x) => x.email));
    } catch (e) {}

    // Группировка по людям, сообщения уже отсортированы по убыванию
    const people = {};
    const order = [];
    for (const m of msgs) {
      if (!people[m.user_email]) {
        people[m.user_email] = { email: m.user_email, last: m, count: 0, hotBell: false, contact: false };
        order.push(m.user_email);
      }
      const p = people[m.user_email];
      if (m.role === "user") {
        p.count++;
        if (m.escalated && !m.worked) p.hotBell = true;
        if (looksLikeContact(m.content)) p.contact = true;
      }
    }
    const dialogs = order.map((e) => people[e]);
    dialogs.sort((a, b) => (b.hotBell - a.hotBell) || (new Date(b.last.created_at) - new Date(a.last.created_at)));

    // Счётчики
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const todayCount = msgs.filter((m) => m.role === "user" && m.created_at >= dayStart.toISOString()).length;
    const weekCount = msgs.filter((m) => m.role === "user" && m.created_at >= weekStart.toISOString()).length;
    const escOpen = msgs.filter((m) => m.role === "user" && m.escalated && !m.worked).length;

    const tag = (p) => {
      if (paidSet.has(p.email)) return '<span class="tag student">ученица</span>';
      if (/^guest_/.test(p.email)) return '<span class="tag guest">гость</span>';
      return '<span class="tag lead">лид</span>';
    };

    const list = dialogs.map((p) => `
      <a class="dlg ${p.hotBell ? "hot" : ""}" href="/api/ts-admin-questions?key=${esc(key)}&dialog=${encodeURIComponent(p.email)}">
        <div class="dlg-top">
          <span class="dlg-who">${who(p.email)}</span> ${tag(p)}
          ${p.contact ? " 🔥" : ""}${p.hotBell ? " 🔔" : ""}
          <span class="dlg-when ts" data-t="${esc(p.last.created_at)}">${esc(String(p.last.created_at || "").slice(0, 16).replace("T", " "))}</span>
        </div>
        <div class="dlg-preview">${p.last.role === "assistant" ? "куратор: " : ""}${esc(String(p.last.content || "").slice(0, 110))}</div>
        <div class="dlg-sub">вопросов: ${p.count}</div>
      </a>`).join("");

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Target School · диалоги</title>
<style>${BASE_CSS}
  .dlg { display: block; background: #fff; border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; text-decoration: none; border: 1px solid #ECECEA; }
  .dlg.hot { background: #FFF3E8; border-color: #F5C79A; }
  .dlg-top { font-size: 14px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .dlg-who { font-weight: 700; }
  .dlg-when { margin-left: auto; color: #999; font-size: 12px; }
  .dlg-preview { color: #555; font-size: 14px; margin-top: 4px; }
  .dlg-sub { color: #999; font-size: 12px; margin-top: 4px; }
  .tag { font-size: 11px; border-radius: 6px; padding: 1px 7px; font-weight: 600; }
  .tag.student { background: #EAF6EC; color: #1B7F3B; }
  .tag.guest { background: #EEE; color: #666; }
  .tag.lead { background: #FFF1D6; color: #A05A00; }
</style></head>
<body>
  <h1>Диалоги с куратором</h1>
  <div class="tools"><a class="btn-link" href="/api/ts-admin?key=${esc(key)}">← в админку</a><a class="btn-link accent" href="/api/ts-admin-questions?key=${esc(key)}&leads=1">🔥 Лиды из чата</a><a class="btn-link" href="/api/ts-admin-questions?key=${esc(key)}&export=1">Скачать CSV</a></div>
  <div class="count">Сегодня вопросов: <b>${todayCount}</b>. За неделю: <b>${weekCount}</b>. Ждут Анастасию: <b style="color:${escOpen ? "#B3261E" : "#1C1C1E"}">${escOpen}</b></div>
  ${list || "<div class='count'>Диалогов пока нет</div>"}
  ${TS_SCRIPT}
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>Ошибка: " + esc(String(e)) + "</p>");
  }
}
