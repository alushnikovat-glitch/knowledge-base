// api/ts-jobs.js
// Живая лента заказов для шага «Где взять первого клиента».
//
// Источник: портал «Работа России», раздел открытых данных.
// Данные опубликованы государством как открытые, доступ свободный: ни ключа,
// ни регистрации, ни разрешения. Поэтому источник нельзя закрыть в одностороннем
// порядке, в отличие от hh, который отключил доступ соискателям 15 декабря 2025.
//
// Ничего не сохраняем: ни в Supabase, ни на диск. Есть короткая память внутри
// самой функции на 15 минут, чтобы не дёргать портал при каждом открытии экрана.
// Контакты работодателей (телефоны, почты) в панель НЕ отдаём: это персональные
// данные конкретных людей, ученица берёт их сама на карточке вакансии.

const API = "https://opendata.trudvsem.ru/api/v1/vacancies";

// Портал ищет по всему тексту, поэтому спрашиваем несколькими формулировками,
// а потом отбираем по названию должности.
const QUERIES = ["таргетолог", "интернет-маркетолог", "специалист по рекламе", "smm-специалист"];

// Название должности должно попасть под это, иначе в ленту не берём.
// Без фильтра приезжает мусор: например, редактор медицинских статей, у которого
// слово «таргетологи» просто упомянуто в рассказе о компании.
const TITLE_OK = /(таргет|интернет[- ]?маркет|digital|диджитал|smm|смм|реклам|маркетолог|продвижени|соцсет|социальны[хм] сет)/i;
// А это в названии означает, что вакансия нам не подходит, даже если слово совпало.
const TITLE_BAD = /(водител|грузчик|продавец|повар|уборщ|охранн|монтажник|слесар|электрик|сварщик|редактор|врач|медицинск|учител|воспитател|бухгалтер|юрист|инженер|токар|оператор станк)/i;

const cache = { at: 0, data: null };
const TTL = 15 * 60 * 1000;

const clean = (s, max = 260) =>
  !s ? "" : String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const money = (v) => {
  const from = Number(v.salary_min) || 0;
  const to = Number(v.salary_max) || 0;
  const n = (x) => x.toLocaleString("ru-RU");
  if (from && to && from !== to) return `${n(from)} – ${n(to)} ₽`;
  if (from) return `от ${n(from)} ₽`;
  if (to) return `до ${n(to)} ₽`;
  return null;
};

async function ask(text) {
  const url = `${API}?${new URLSearchParams({ text, limit: "50", offset: "0" })}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`trudvsem ${r.status}`);
  const j = await r.json();
  return j?.results?.vacancies || [];
}


// ===== ЗАРУБЕЖНАЯ УДАЛЁНКА =====
// Remotive и RemoteOK отдают открытые ленты без ключей и регистрации.
// Для тех, кто уехал или собирается: работа не привязана к стране, платят в валюте.
// Вакансии на английском, об этом честно предупреждаем в панели.

const worldCache = { at: 0, data: null };

const usd = (min, max) => {
  const n = (x) => Math.round(Number(x)).toLocaleString("ru-RU");
  if (min && max && min !== max) return `$${n(min)} – $${n(max)}`;
  if (min) return `от $${n(min)}`;
  if (max) return `до $${n(max)}`;
  return null;
};

async function fromRemotive() {
  const r = await fetch("https://remotive.com/api/remote-jobs?category=marketing&limit=40", {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`remotive ${r.status}`);
  const j = await r.json();
  return (j.jobs || []).map((v) => ({
    id: `rv-${v.id}`,
    title: clean(v.title, 120),
    company: clean(v.company_name, 90),
    city: clean(v.candidate_required_location || "весь мир", 60),
    salary: clean(v.salary, 40) || null,
    remote: true,
    published: v.publication_date || null,
    need: "",
    task: clean(v.description, 260),
    url: v.url || null,
    world: true,
  }));
}

async function fromRemoteOK() {
  const r = await fetch("https://remoteok.com/api", {
    headers: { Accept: "application/json", "User-Agent": "TargetSchool/1.0 (обучающая панель)" },
  });
  if (!r.ok) throw new Error(`remoteok ${r.status}`);
  const j = await r.json();
  // Первый элемент их ленты — служебное уведомление, не вакансия
  const rows = Array.isArray(j) ? j.slice(1) : [];
  return rows
    .filter((v) => {
      const tags = (v.tags || []).join(" ").toLowerCase();
      return /market|advertis|growth|media buy|social/.test(tags + " " + String(v.position || "").toLowerCase());
    })
    .map((v) => ({
      id: `ro-${v.id || v.slug}`,
      title: clean(v.position, 120),
      company: clean(v.company, 90),
      city: clean(v.location || "весь мир", 60),
      salary: usd(v.salary_min, v.salary_max),
      remote: true,
      published: v.date || null,
      need: (v.tags || []).slice(0, 5).join(", "),
      task: clean(v.description, 260),
      url: v.url || (v.slug ? `https://remoteok.com/remote-jobs/${v.slug}` : null),
      world: true,
    }));
}

async function worldJobs() {
  if (worldCache.data && Date.now() - worldCache.at < TTL) {
    return { ...worldCache.data, cached: true };
  }
  const packs = await Promise.all([fromRemotive().catch(() => []), fromRemoteOK().catch(() => [])]);
  const seen = new Set();
  const jobs = [];
  for (const p of packs) {
    for (const j of p) {
      if (!j.title || seen.has(j.id)) continue;
      seen.add(j.id);
      jobs.push(j);
    }
  }
  jobs.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  const data = { found: jobs.length, jobs: jobs.slice(0, 20), at: new Date().toISOString() };
  worldCache.at = Date.now();
  worldCache.data = data;
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=600");

  // Вкладка «весь мир»: удалёнка на зарубежных площадках
  if (req.query?.scope === "world") {
    try {
      return res.status(200).json(await worldJobs());
    } catch (e) {
      console.error("ts-jobs world error:", e.message);
      return res.status(200).json({ found: 0, jobs: [], error: true });
    }
  }

  if (cache.data && Date.now() - cache.at < TTL) {
    return res.status(200).json({ ...cache.data, cached: true });
  }

  try {
    const packs = await Promise.all(QUERIES.map((q) => ask(q).catch(() => [])));

    const seen = new Set();
    const jobs = [];

    for (const pack of packs) {
      for (const row of pack) {
        const v = row?.vacancy;
        if (!v || seen.has(v.id)) continue;

        const title = clean(v["job-name"], 120);
        if (!TITLE_OK.test(title) || TITLE_BAD.test(title)) continue;
        seen.add(v.id);

        const emp = String(v.employment || "");
        const schedComment = String(v.scheduleTypeComment || "");

        jobs.push({
          id: v.id,
          title,
          company: clean(v.company?.name || "", 90).replace(/^(ООО|АО|ИП|ЗАО|ПАО)\s+/i, (m) => m),
          city: clean(v.region?.name || "", 50),
          salary: money(v),
          remote: /дистанц|удал/i.test(emp) || /удал/i.test(schedComment),
          published: v.date_modify || v["creation-date"] || null,
          need: clean(v.requirements || "", 200),
          task: clean(v.duty || "", 260),
          url: v.vac_url || null,
        });
      }
    }

    jobs.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));

    const data = { found: jobs.length, jobs: jobs.slice(0, 20), at: new Date().toISOString() };
    cache.at = Date.now();
    cache.data = data;
    return res.status(200).json(data);
  } catch (e) {
    console.error("ts-jobs error:", e.message);
    if (cache.data) return res.status(200).json({ ...cache.data, stale: true });
    return res.status(200).json({ found: 0, jobs: [], error: true });
  }
}
