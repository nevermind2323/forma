/* Подбор набора продуктов на день из сохранённого списка Лавки (порт menu.py из «Ужин из Лавки»). */
(function (root) {
  'use strict';
  var MAX_LINES = 8, BOWL_SLACK = 0.3, FRUIT_G = 150, GRANOLA_G = 40;
  var DRINK_ML_MIN = 1000, DRINK_ML_MAX = 1500, DRINK_EXTRA_RUB = 60;
  var ROLES = ['meal', 'cook', 'cottage', 'yogurt', 'fruit', 'granola', 'drink'];

  function rngFrom(seed) { // mulberry32: одинаковый seed даёт одинаковый результат
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var randrange = function (r, n) { return Math.floor(r() * n); };
  var choice = function (r, a) { return a[randrange(r, a.length)]; };

  /* [название, цена, вес, ккал, белок, жиры, углеводы, ссылка, готовить] -> объект */
  function expand(raw) {
    var pool = {};
    ROLES.forEach(function (k) {
      pool[k] = (raw.p[k] || []).map(function (r) {
        var o = { title: r[0], price: r[1], weight: r[2], kcal: r[3], protein: r[4], fat: r[5], carbs: r[6], href: '/good/' + r[7] };
        if (k === 'drink') o.drink = true;
        if (r[8]) o.cook = true;
        return o;
      });
    });
    return pool;
  }

  function totals(lines) {
    var t = { kcal: 0, protein: 0, fat: 0, carbs: 0, price: 0 };
    lines.forEach(function (l) { for (var k in t) t[k] += l[0][k] * l[1]; });
    return t;
  }

  function config(g) {
    return {
      kcal: g.kcal, kcalMin: Math.round(g.kcal * 0.9), kcalMax: Math.round(g.kcal * 1.15),
      protein: g.protein, proteinMax: Math.round(g.protein * 1.35),
      fat: Math.max(g.fat, 1), carbs: Math.max(g.carbs, 1),
      budget: g.budget, budgetMax: Math.round(g.budget * 1.13)
    };
  }

  function penalty(G, t, budget) {
    budget = budget || G.budget;
    var p = Math.abs(t.kcal - G.kcal) / G.kcal;
    p += 0.25 * Math.abs(t.fat - G.fat) / G.fat + 0.15 * Math.abs(t.carbs - G.carbs) / G.carbs;
    p += Math.max(0, G.protein - t.protein) / G.protein * 3;
    p += Math.max(0, t.protein - G.proteinMax) / G.proteinMax;
    p += Math.max(0, t.price - budget) / budget * 2;
    if (t.kcal < G.kcalMin) p += 1;
    if (t.kcal > G.kcalMax) p += 1;
    return p;
  }

  function isOk(G, t) { return t.kcal >= G.kcalMin && t.kcal <= G.kcalMax && t.protein >= G.protein && t.price <= G.budgetMax; }

  function search(G, items, rng, budget, start) {
    var cur = new Map(), n = 3 + randrange(rng, 4), i;
    for (i = 0; i < n; i++) cur.set(randrange(rng, items.length), 1);
    if (start != null) cur.set(start, 1);
    function score(c) {
      var lines = [], bowls = 0;
      c.forEach(function (q, k) { lines.push([items[k], q]); if (items[k].bowl) bowls++; });
      var p = penalty(G, totals(lines), budget);
      return bowls > 1 ? p + 5 : p;
    }
    var best = score(cur);
    for (var step = 0; step < 250; step++) {
      var c = new Map(cur), r = rng(), j = randrange(rng, items.length), keys;
      if (r < 0.35 && c.size < MAX_LINES) c.set(j, 1);
      else if (r < 0.55 && c.size > 2) { keys = Array.from(c.keys()); c.delete(choice(rng, keys)); }
      else if (r < 0.8 && c.size) { keys = Array.from(c.keys()); c.delete(choice(rng, keys)); c.set(j, 1); }
      var s = score(c);
      if (s <= best) { cur = c; best = s; }
    }
    return [cur, best];
  }

  /* --- напитки: 1–1,5 литра почти без калорий, лучше газировка без сахара --- */
  var SODA = /(^|[^а-яёa-z])(кола|cola)($|[^а-яёa-z])|пепси|pepsi|фанта|fanta|спрайт|sprite|швепп|schwepp|добрый|лимонад|тоник|dr\.? ?pepper|mountain dew/;
  function isSoda(title) { var t = title.toLowerCase(); return SODA.test(t) && t.indexOf('вода') < 0; }
  var cost = function (o) { return o.reduce(function (s, l) { return s + l[0].price * l[1]; }, 0); };

  function drinkOptions(drinks) {
    var opts = [];
    drinks.forEach(function (a, i) {
      if (a.weight >= DRINK_ML_MIN && a.weight <= DRINK_ML_MAX) opts.push([[a, 1]]);
      for (var j = i + 1; j < drinks.length; j++) {
        var b = drinks[j], w = a.weight + b.weight;
        if (w >= DRINK_ML_MIN && w <= DRINK_ML_MAX) opts.push([[a, 1], [b, 1]]);
      }
    });
    return opts;
  }
  function preferred(opts) {
    var tests = [function (o) { return o.every(function (l) { return isSoda(l[0].title); }); },
                 function (o) { return o.some(function (l) { return isSoda(l[0].title); }); }];
    for (var i = 0; i < tests.length; i++) { var p = opts.filter(tests[i]); if (p.length) return p; }
    return opts;
  }
  function pickDrinks(opts, rng, used) {
    if (!opts.length) return [];
    var ranked = preferred(opts).sort(function (a, b) { return cost(a) - cost(b); });
    var cheap = ranked.filter(function (o) { return cost(o) <= cost(ranked[0]) + DRINK_EXTRA_RUB; });
    var fresh = cheap.filter(function (o) { return !o.some(function (l) { return used.has(l[0].href); }); });
    var ch = choice(rng, fresh.length ? fresh : cheap);
    ch.forEach(function (l) { used.add(l[0].href); });
    return ch;
  }

  /* --- творожная чаша: творог + йогурт + фрукты + гранола --- */
  function eaten(it, grams) {
    if (!grams || it.weight <= grams) return it;
    var f = grams / it.weight, o = Object.assign({}, it, { weight: grams });
    ['kcal', 'protein', 'fat', 'carbs'].forEach(function (k) { o[k] = it[k] * f; });
    return o;
  }
  function shortTitle(t) { return t.replace(/\s*\d+(?:[.,]\d+)?\s*(кг|г|мл|л)\.?$/, ''); }

  function makeBowls(pool, rng) {
    var pools = [[pool.cottage, 0], [pool.yogurt, 0], [pool.fruit, FRUIT_G], [pool.granola, GRANOLA_G]]
      .filter(function (x) { return x[0] && x[0].length; });
    if (!((pool.cottage && pool.cottage.length) || (pool.yogurt && pool.yogurt.length))) return [];
    var bowls = [], seen = new Set();
    for (var n = 0; n < 180 && bowls.length < 30; n++) {
      var picks = pools.map(function (x) { return [choice(rng, x[0]), x[1]]; });
      var key = picks.map(function (p) { return p[0].href; }).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      var t = totals(picks.map(function (p) { return [eaten(p[0], p[1]), 1]; }));
      if (!(t.kcal >= 300 && t.kcal <= 800 && t.price <= 700)) continue;
      var parts = picks.map(function (p) { return p[0]; });
      bowls.push(Object.assign({
        href: 'bowl:' + key, bowl: true, parts: parts,
        weight: picks.reduce(function (s, p) { return s + eaten(p[0], p[1]).weight; }, 0),
        title: 'Творожная чаша: ' + parts.map(function (p) { return shortTitle(p.title); }).join(' + ')
      }, t));
    }
    return bowls;
  }

  function overlap(a, b) {
    var inter = 0;
    a.forEach(function (x) { if (b.has(x)) inter++; });
    return inter / Math.min(a.size, b.size);
  }

  function buildMenus(G, items, drinks, n, seed) {
    if (!items.length) return [];
    var rng = rngFrom(seed), opts = drinkOptions(drinks);
    var pref = preferred(opts), cheapest = pref.length ? Math.min.apply(null, pref.map(cost)) : 0;
    var bowlIds = [];
    items.forEach(function (it, i) { if (it.bowl) bowlIds.push(i); });
    var found = new Map();
    for (var k = 0; k < 300; k++) {
      var start = bowlIds.length && k % 3 === 0 ? choice(rng, bowlIds) : null;
      var res = search(G, items, rng, G.budget - cheapest, start);
      var key = Array.from(res[0].keys()).sort(function (a, b) { return a - b; }).join(',');
      found.set(key, res);
    }
    var ranked = Array.from(found.values()).sort(function (a, b) { return a[1] - b[1]; });
    var picked = [];
    var withBowl = ranked.filter(function (x) { return Array.from(x[0].keys()).some(function (i) { return items[i].bowl; }); });
    if (withBowl.length && withBowl[0][1] <= ranked[0][1] + BOWL_SLACK) picked.push(withBowl[0]);
    for (var r = 0; r < ranked.length && picked.length < n; r++) {
      var ks = new Set(ranked[r][0].keys());
      if (picked.every(function (p) { return overlap(ks, new Set(p[0].keys())) <= 0.34; })) picked.push(ranked[r]);
    }
    var used = new Set();
    return picked.map(function (p) {
      var lines = Array.from(p[0].keys()).sort(function (a, b) { return a - b; }).map(function (i) { return [items[i], p[0].get(i)]; });
      var drink = pickDrinks(opts, rng, used);
      lines = lines.concat(drink);
      var t = totals(lines);
      return { lines: lines, total: t, ok: isOk(G, t), hasDrink: drink.length > 0 };
    });
  }

  /* pool: объекты по ролям; goals: {kcal, protein, fat, carbs, budget}; возвращает до n наборов */
  function plan(pool, goals, seed, n) {
    var G = config(goals), rng = rngFrom(seed ^ 0x9e3779b9);
    var items = (pool.meal || []).concat(pool.cook || [], makeBowls(pool, rng));
    var menus = buildMenus(G, items, pool.drink || [], n || 3, seed);
    menus.forEach(function (m) { m.goals = G; });
    return menus;
  }

  var api = { expand: expand, plan: plan, totals: totals, isSoda: isSoda };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LavkaPlan = api;
})(typeof window !== 'undefined' ? window : this);
