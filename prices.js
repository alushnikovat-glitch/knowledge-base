/* =====================================================================
   ЦЕНЫ НА САЙТЕ. Меняете здесь, и цена меняется на всех страницах.

   Как поменять:
   1. На GitHub откройте этот файл и нажмите карандаш (Edit).
   2. Поменяйте число или дату в блоке ниже. Пробелы в числах не нужны: 45000.
   3. Нажмите Commit changes. Через пару минут цена обновится везде.

   price       сколько стоит сейчас
   promoUntil  до какого дня цена акционная, формат "ГГГГ-ММ-ДД".
               В этот день пометка «по акции» исчезнет сама.
               Нет акции: поставьте null
   priceAfter  цена после окончания акции. Не знаете: null,
               тогда после акции останется price
   ===================================================================== */

window.PRICES = {
  strategiya:     { name: "Стратегия",                    price: 45000, promoUntil: "2026-11-01", priceAfter: 49900 },
  soprovozhdenie: { name: "Стратегия и сопровождение",    price: 99000, promoUntil: null,         priceAfter: null }
};

/* ============ Ниже ничего менять не нужно ============ */
(function () {
  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  var MONTHS_NOM = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  function d(s) { return s ? new Date(s + 'T00:00:00+03:00') : null; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
  function state(key) {
    var p = window.PRICES[key]; if (!p) return null;
    var until = d(p.promoUntil), now = new Date();
    var promo = !!until && now < until;
    var price = (!promo && until && now >= until && p.priceAfter) ? p.priceAfter : p.price;
    var dayTxt = until ? until.getDate() + ' ' + MONTHS[until.getMonth()] : '';
    return { price: price, promo: promo, date: dayTxt };
  }
  window.priceState = state;
  window.priceText = function (key) { var s = state(key); return s ? fmt(s.price) : ''; };
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-price]').forEach(function (el) {
      var s = state(el.getAttribute('data-price')); if (s) el.textContent = fmt(s.price);
    });
    root.querySelectorAll('[data-promo]').forEach(function (el) {
      var s = state(el.getAttribute('data-promo'));
      if (!s || !s.promo) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.querySelectorAll('[data-promo-date]').forEach(function (x) { x.textContent = s.date; });
      var pa = window.PRICES[el.getAttribute('data-promo')].priceAfter;
      el.querySelectorAll('[data-price-after]').forEach(function (x) { if (pa) x.textContent = fmt(pa); else x.parentNode && (x.closest('[data-after-wrap]') || x).remove(); });
    });
    root.querySelectorAll('[data-month]').forEach(function (el) {
      el.textContent = MONTHS_NOM[new Date().getMonth()];
    });
  }
  window.applyPrices = apply;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); });
  else apply();
})();
