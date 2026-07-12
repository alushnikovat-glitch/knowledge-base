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

export default async function handler(req, res) {
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
