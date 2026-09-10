// api/lava-webhook.js
// Почтовый ящик: принимает уведомление об оплате от lava.top
// и пересылает событие «Покупка» в Meta (Conversions API).
//
// Куда положить: в репозиторий сайта, папка /api, файл lava-webhook.js
// Vercel сам превратит его в рабочий адрес:
// https://anastasialushnikova.com/api/lava-webhook
//
// Перед работой добавить в Vercel → Settings → Environment Variables:
//   META_PIXEL_ID   = 2700527913660797
//   META_CAPI_TOKEN = токен из Events Manager (ниже написано, где взять)
//   LAVA_API_KEY    = API-ключ, созданный в lava.top в разделе Интеграция

import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────
// Дополнительно (10.09.2026): проверка подписки на канал для мини-приложения @tschoolai_bot.
// Живёт в этом же файле, потому что на тарифе Hobby в Vercel можно не больше 12 функций.
// Вызывается только адресом /api/lava-webhook?action=tg-sub, уведомления lava.top сюда не попадают.
// Нужна переменная TG_BOT_TOKEN (токен @tschoolai_bot). Бот должен быть администратором канала.
// Без токена пропускает всех, чтобы приложение не закрылось.
// ─────────────────────────────────────────────────────────────
function tgCheckInitData(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc !== hash) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

async function tgSubscription(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = process.env.TG_BOT_TOKEN;
  const channel = process.env.TG_CHANNEL || '@target_school1';
  if (!token) return res.status(200).json({ subscribed: true, reason: 'no-token' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const user = tgCheckInitData(body.initData || '', token);
  if (!user || !user.id) return res.status(401).json({ subscribed: false, reason: 'bad-init-data' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${user.id}`);
    const j = await r.json();
    if (!j.ok) {
      console.warn('tg-sub: Telegram ответил ошибкой', j.description);
      return res.status(200).json({ subscribed: true, reason: 'tg-error' });
    }
    const s = j.result.status;
    const subscribed = s === 'creator' || s === 'administrator' || s === 'member' || (s === 'restricted' && j.result.is_member);
    return res.status(200).json({ subscribed });
  } catch (e) {
    console.error('tg-sub:', e);
    return res.status(200).json({ subscribed: true, reason: 'fetch-error' });
  }
}


export default async function handler(req, res) {
  // Мини-приложение: проверка подписки. Остальной код ниже не тронут.
  if (req.query && req.query.action === 'tg-sub') return tgSubscription(req, res);

  // lava.top шлёт уведомления методом POST, остальное игнорируем
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Проверка, что стучится именно lava.top, а не посторонний.
  // lava.top передаёт ключ в заголовке авторизации (значение = ваш API-ключ).
  const incomingKey =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    '';
  if (process.env.LAVA_API_KEY && incomingKey !== process.env.LAVA_API_KEY) {
    console.warn('lava-webhook: неверный ключ, запрос отклонён');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  console.log('lava-webhook: входящее событие', JSON.stringify(body));

  // --- Разбираем записку от lava.top ---
  // ВАЖНО: точные имена полей сверить с реальным телом запроса.
  // Его видно в кабинете lava.top: Интеграция → журнал вебхуков → детали платежа.
  // Ниже перечислены самые вероятные варианты имён, код берёт первое найденное.
  const eventType = body.eventType || body.type || body.event || '';
  const status = (body.status || body.contractStatus || '').toLowerCase();
  const email =
    body.buyer?.email || body.email || body.clientEmail || body.buyerEmail || '';
  const amount = Number(body.amount || body.sum || body.price || 0);
  const currency = (body.currency || 'RUB').toUpperCase();
  const orderId =
    body.contractId || body.orderId || body.id || crypto.randomUUID();
  const productName =
    body.product?.title || body.productTitle || body.title || 'Архитектор смыслов';

  // Реагируем только на успешную оплату.
  // Статусы вида failed / cancelled пропускаем: отвечаем «принято» и молчим,
  // иначе lava.top будет пытаться слать повторно.
  const successMarkers = ['completed', 'success', 'paid', 'active', 'subscription-active', 'new'];
  const isPaid = successMarkers.some((m) => status.includes(m));
  if (!isPaid) {
    console.log('lava-webhook: статус не оплачен, пропускаю:', status, eventType);
    return res.status(200).json({ received: true, skipped: true });
  }

  // --- Готовим событие для Meta ---
  // Почту Фейсбук принимает только в зашифрованном виде (sha256),
  // по ней он находит человека и учится на покупателях.
  const hashedEmail = email
    ? crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
    : null;

  const metaEvent = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(orderId), // защита от задвоения события
        action_source: 'website',
        event_source_url: 'https://anastasialushnikova.com/arkhitektor',
        user_data: {
          ...(hashedEmail ? { em: [hashedEmail] } : {}),
          client_ip_address:
            req.headers['x-forwarded-for']?.split(',')[0] || undefined,
        },
        custom_data: {
          currency: currency,
          value: amount,
          content_name: productName,
        },
      },
    ],
  };

  // --- Отправляем в Meta Conversions API ---
  try {
    const url = `https://graph.facebook.com/v21.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_CAPI_TOKEN}`;
    const fbRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaEvent),
    });
    const fbJson = await fbRes.json();
    console.log('lava-webhook: ответ Meta', JSON.stringify(fbJson));

    if (!fbRes.ok) {
      // Метке всё равно отвечаем 200, чтобы lava.top не заспамил повторами,
      // а проблему увидим в логах Vercel.
      console.error('lava-webhook: Meta вернула ошибку', fbJson);
    }
  } catch (err) {
    console.error('lava-webhook: не удалось достучаться до Meta', err);
  }

  return res.status(200).json({ received: true });
}
