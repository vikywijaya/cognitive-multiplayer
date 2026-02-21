'use strict';
(function () {

  // ── 1. DATA ───────────────────────────────────────────────────────────────

  const MEALS = [
    // Rice & Noodles
    { id: 'chicken-rice',    name: 'Hainanese Chicken Rice', category: 'Rice & Noodles',    emoji: '🍚', cal: 607, carbs: 74, protein: 32, fat: 18, satFat:  4, sodium: 980,  sugar:  3, serving: '1 plate (~450g)' },
    { id: 'char-kway-teow', name: 'Char Kway Teow',          category: 'Rice & Noodles',    emoji: '🍜', cal: 743, carbs: 89, protein: 26, fat: 30, satFat: 10, sodium: 1680, sugar:  6, serving: '1 plate (~400g)' },
    { id: 'laksa',          name: 'Laksa (Katong)',           category: 'Rice & Noodles',    emoji: '🍲', cal: 590, carbs: 60, protein: 24, fat: 27, satFat: 14, sodium: 1490, sugar:  5, serving: '1 bowl (~500g)' },
    { id: 'nasi-lemak',     name: 'Nasi Lemak',               category: 'Rice & Noodles',    emoji: '🍛', cal: 494, carbs: 55, protein: 18, fat: 22, satFat: 10, sodium: 880,  sugar:  4, serving: '1 set (~380g)' },
    { id: 'wanton-mee-dry', name: 'Wanton Mee (Dry)',         category: 'Rice & Noodles',    emoji: '🍝', cal: 508, carbs: 68, protein: 22, fat: 15, satFat:  4, sodium: 1320, sugar:  7, serving: '1 plate (~350g)' },
    { id: 'wanton-mee-soup',name: 'Wanton Mee (Soup)',        category: 'Rice & Noodles',    emoji: '🍜', cal: 430, carbs: 60, protein: 20, fat: 11, satFat:  3, sodium: 1450, sugar:  4, serving: '1 bowl (~400g)' },
    { id: 'fried-rice',     name: 'Egg Fried Rice',           category: 'Rice & Noodles',    emoji: '🍳', cal: 625, carbs: 80, protein: 18, fat: 24, satFat:  5, sodium: 1240, sugar:  2, serving: '1 plate (~400g)' },
    { id: 'bak-chor-mee',  name: 'Bak Chor Mee (Dry)',       category: 'Rice & Noodles',    emoji: '🍜', cal: 520, carbs: 65, protein: 24, fat: 17, satFat:  4, sodium: 1350, sugar:  5, serving: '1 plate (~350g)' },
    { id: 'hokkien-mee',   name: 'Hokkien Mee',               category: 'Rice & Noodles',    emoji: '🦐', cal: 670, carbs: 82, protein: 28, fat: 22, satFat:  6, sodium: 1580, sugar:  4, serving: '1 plate (~400g)' },
    { id: 'mee-rebus',     name: 'Mee Rebus',                 category: 'Rice & Noodles',    emoji: '🍜', cal: 498, carbs: 72, protein: 20, fat: 12, satFat:  4, sodium: 1100, sugar: 10, serving: '1 plate (~400g)' },
    { id: 'mee-goreng',    name: 'Mee Goreng (Malay)',         category: 'Rice & Noodles',    emoji: '🍜', cal: 660, carbs: 85, protein: 22, fat: 22, satFat:  6, sodium: 1500, sugar:  8, serving: '1 plate (~400g)' },
    { id: 'prawn-noodles', name: 'Prawn Noodles (Soup)',       category: 'Rice & Noodles',    emoji: '🦐', cal: 440, carbs: 52, protein: 26, fat: 12, satFat:  3, sodium: 1620, sugar:  2, serving: '1 bowl (~500g)' },
    { id: 'lor-mee',       name: 'Lor Mee',                   category: 'Rice & Noodles',    emoji: '🍜', cal: 510, carbs: 70, protein: 22, fat: 13, satFat:  4, sodium: 1400, sugar:  6, serving: '1 bowl (~450g)' },
    { id: 'economy-rice',  name: 'Economy Rice (2 veg, 1 meat)', category: 'Rice & Noodles', emoji: '🍚', cal: 580, carbs: 72, protein: 22, fat: 20, satFat:  6, sodium: 920,  sugar:  3, serving: '1 plate (~400g)' },
    { id: 'mixed-veg-rice',name: 'Mixed Veg Rice (3 veg)',     category: 'Rice & Noodles',    emoji: '🥦', cal: 460, carbs: 75, protein: 14, fat: 10, satFat:  2, sodium: 760,  sugar:  3, serving: '1 plate (~400g)' },

    // Bread & Indian
    { id: 'roti-prata-plain', name: 'Roti Prata (Plain, 2 pcs)', category: 'Bread & Indian', emoji: '🫓', cal: 408, carbs: 52, protein: 10, fat: 18, satFat:  9, sodium: 580,  sugar:  3, serving: '2 pieces + curry' },
    { id: 'roti-prata-egg',   name: 'Roti Prata (Egg, 1 pc)',    category: 'Bread & Indian', emoji: '🫓', cal: 310, carbs: 34, protein: 10, fat: 15, satFat:  8, sodium: 520,  sugar:  2, serving: '1 piece + curry' },
    { id: 'thosai',           name: 'Thosai (Plain)',             category: 'Bread & Indian', emoji: '🥞', cal: 210, carbs: 38, protein:  6, fat:  4, satFat:  1, sodium: 340,  sugar:  1, serving: '1 piece (~120g)' },
    { id: 'naan',             name: 'Naan with Curry',            category: 'Bread & Indian', emoji: '🫓', cal: 490, carbs: 65, protein: 16, fat: 16, satFat:  6, sodium: 820,  sugar:  5, serving: '1 naan + curry' },
    { id: 'murtabak',         name: 'Murtabak (Mutton)',          category: 'Bread & Indian', emoji: '🥙', cal: 620, carbs: 58, protein: 28, fat: 29, satFat: 12, sodium: 1060, sugar:  4, serving: '1 piece (~300g)' },
    { id: 'briyani-chicken',  name: 'Chicken Briyani',            category: 'Bread & Indian', emoji: '🍛', cal: 710, carbs: 82, protein: 34, fat: 24, satFat:  8, sodium: 1150, sugar:  5, serving: '1 plate (~500g)' },

    // Soups & Porridge
    { id: 'bak-kut-teh',   name: 'Bak Kut Teh',                  category: 'Soups & Porridge', emoji: '🍖', cal: 420, carbs: 12, protein: 32, fat: 26, satFat: 10, sodium: 1350, sugar:  1, serving: '1 bowl ribs + broth' },
    { id: 'fish-ball-soup', name: 'Fish Ball Soup Noodles',       category: 'Soups & Porridge', emoji: '🐟', cal: 370, carbs: 52, protein: 22, fat:  6, satFat:  1, sodium: 1280, sugar:  2, serving: '1 bowl (~450g)' },
    { id: 'yong-tau-foo',  name: 'Yong Tau Foo (Soup, 5 pcs)',    category: 'Soups & Porridge', emoji: '🥟', cal: 310, carbs: 38, protein: 20, fat:  6, satFat:  2, sodium: 980,  sugar:  3, serving: '5 pieces + noodles' },
    { id: 'congee',        name: 'Congee (w/ accompaniments)',     category: 'Soups & Porridge', emoji: '🥣', cal: 290, carbs: 48, protein: 14, fat:  5, satFat:  1, sodium: 740,  sugar:  1, serving: '1 bowl (~400g)' },
    { id: 'sup-tulang',    name: 'Sup Tulang (Mutton Bone Soup)',  category: 'Soups & Porridge', emoji: '🦴', cal: 380, carbs:  8, protein: 28, fat: 24, satFat: 11, sodium: 1180, sugar:  1, serving: '1 bowl (~400g)' },
    { id: 'satay-bee-hoon',name: 'Satay Bee Hoon',                category: 'Soups & Porridge', emoji: '🍢', cal: 545, carbs: 68, protein: 22, fat: 19, satFat:  6, sodium: 1050, sugar:  8, serving: '1 plate (~380g)' },

    // Snacks & Sides
    { id: 'satay',         name: 'Satay (6 sticks, Chicken)',   category: 'Snacks & Sides', emoji: '🍢', cal: 348, carbs: 18, protein: 30, fat: 16, satFat:  5, sodium: 720,  sugar: 12, serving: '6 sticks + peanut sauce' },
    { id: 'popiah',        name: 'Popiah (Fresh, 1 roll)',       category: 'Snacks & Sides', emoji: '🌯', cal: 185, carbs: 26, protein:  8, fat:  5, satFat:  1, sodium: 420,  sugar:  5, serving: '1 roll (~130g)' },
    { id: 'spring-roll',   name: 'Spring Roll (Fried, 2 pcs)',  category: 'Snacks & Sides', emoji: '🥢', cal: 280, carbs: 28, protein:  8, fat: 15, satFat:  5, sodium: 480,  sugar:  2, serving: '2 pieces (~120g)' },
    { id: 'otak-otak',     name: 'Otak Otak (2 pcs)',           category: 'Snacks & Sides', emoji: '🐠', cal: 160, carbs:  8, protein: 14, fat:  8, satFat:  3, sodium: 540,  sugar:  2, serving: '2 pieces (~80g)' },
    { id: 'curry-puff',    name: 'Curry Puff',                  category: 'Snacks & Sides', emoji: '🥐', cal: 260, carbs: 30, protein:  7, fat: 12, satFat:  5, sodium: 380,  sugar:  2, serving: '1 piece (~100g)' },
    { id: 'tau-huay',      name: 'Tau Huay (Soybean Curd)',     category: 'Snacks & Sides', emoji: '🍮', cal: 110, carbs: 18, protein:  6, fat:  2, satFat:  0, sodium:  20,  sugar: 14, serving: '1 bowl (~250g)' },
    { id: 'goreng-pisang', name: 'Goreng Pisang (3 pcs)',       category: 'Snacks & Sides', emoji: '🍌', cal: 330, carbs: 52, protein:  3, fat: 12, satFat:  5, sodium: 130,  sugar: 24, serving: '3 pieces (~150g)' },
    { id: 'putu-piring',   name: 'Putu Piring (4 pcs)',         category: 'Snacks & Sides', emoji: '🍡', cal: 240, carbs: 48, protein:  4, fat:  4, satFat:  2, sodium: 160,  sugar: 18, serving: '4 pieces (~120g)' },
    { id: 'kueh-lapis',    name: 'Kueh Lapis (2 slices)',       category: 'Snacks & Sides', emoji: '🎂', cal: 280, carbs: 46, protein:  4, fat:  9, satFat:  5, sodium: 140,  sugar: 28, serving: '2 slices (~100g)' },

    // Drinks & Desserts
    { id: 'teh-tarik',      name: 'Teh Tarik (Medium)',       category: 'Drinks & Desserts', emoji: '🧋', cal: 160, carbs: 28, protein:  4, fat:  4, satFat:  2, sodium:  60, sugar: 26, serving: '1 cup (~300ml)' },
    { id: 'kopi-o',         name: 'Kopi-O (Black, Sweetened)',category: 'Drinks & Desserts', emoji: '☕', cal:  80, carbs: 18, protein:  1, fat:  0, satFat:  0, sodium:  20, sugar: 17, serving: '1 cup (~250ml)' },
    { id: 'kopi',           name: 'Kopi (with Evap. Milk)',   category: 'Drinks & Desserts', emoji: '☕', cal: 130, carbs: 20, protein:  3, fat:  4, satFat:  2, sodium:  50, sugar: 18, serving: '1 cup (~250ml)' },
    { id: 'milo-dinosaur',  name: 'Milo Dinosaur',            category: 'Drinks & Desserts', emoji: '🥛', cal: 350, carbs: 60, protein:  8, fat:  9, satFat:  5, sodium: 140, sugar: 52, serving: '1 cup (~400ml)' },
    { id: 'bandung',        name: 'Bandung (Rose Syrup Milk)',category: 'Drinks & Desserts', emoji: '🌸', cal: 190, carbs: 38, protein:  4, fat:  3, satFat:  2, sodium:  70, sugar: 36, serving: '1 cup (~350ml)' },
    { id: 'ice-kachang',    name: 'Ice Kachang',              category: 'Drinks & Desserts', emoji: '🍧', cal: 260, carbs: 60, protein:  4, fat:  2, satFat:  1, sodium:  80, sugar: 54, serving: '1 bowl (~400g)' },
    { id: 'chendol',        name: 'Chendol',                  category: 'Drinks & Desserts', emoji: '🍨', cal: 290, carbs: 55, protein:  3, fat:  8, satFat:  6, sodium:  60, sugar: 48, serving: '1 bowl (~400g)' },
    { id: 'sugarcane-juice',name: 'Sugarcane Juice',          category: 'Drinks & Desserts', emoji: '🌿', cal: 110, carbs: 27, protein:  0, fat:  0, satFat:  0, sodium:  10, sugar: 26, serving: '1 cup (~300ml)' },
  ];

  const MOH = {
    cal:     { value: 2000, unit: 'kcal', label: 'Calories',        note: 'HPB average adult reference' },
    carbs:   { value: 288,  unit: 'g',    label: 'Carbohydrates',   note: '55–60% of total energy' },
    protein: { value: 55,   unit: 'g',    label: 'Protein',         note: '~0.8g per kg body weight' },
    fat:     { value: 67,   unit: 'g',    label: 'Total Fat',       note: '≤30% of total energy' },
    satFat:  { value: 22,   unit: 'g',    label: 'Saturated Fat',   note: '≤10% of total energy' },
    sodium:  { value: 2000, unit: 'mg',   label: 'Sodium',          note: 'HPB: ≤2000 mg/day (5g salt)' },
    sugar:   { value: 50,   unit: 'g',    label: 'Free Sugar',      note: 'WHO: ≤10% of total energy' },
  };

  const NUTRIENTS = ['cal', 'carbs', 'protein', 'fat', 'satFat', 'sodium', 'sugar'];

  const CATEGORIES = ['All', 'Rice & Noodles', 'Bread & Indian', 'Soups & Porridge', 'Snacks & Sides', 'Drinks & Desserts'];

  const CAT_IMG_CLASS = {
    'Rice & Noodles':   'food-img-rice',
    'Bread & Indian':   'food-img-bread',
    'Soups & Porridge': 'food-img-soup',
    'Snacks & Sides':   'food-img-snack',
    'Drinks & Desserts':'food-img-drink',
  };

  const SLOTS = [
    { id: 'breakfast', label: 'Breakfast', emoji: '🌅' },
    { id: 'lunch',     label: 'Lunch',     emoji: '☀️' },
    { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
    { id: 'snack',     label: 'Snacks',    emoji: '🍪' },
  ];

  const EDU_TIPS = {
    sodium:  { icon: '🧂', title: 'High Sodium Alert', text: 'Singaporeans consume an average of 3,600 mg sodium daily — nearly double the HPB recommendation. Hawker soups and sauces are key contributors. Ask for less sauce or opt for soups with reduced sodium.' },
    satFat:  { icon: '🥥', title: 'Saturated Fat Watch', text: 'Coconut milk (santan) used in laksa, nasi lemak, and kueh is high in saturated fat. The HPB recommends ≤10% of energy from saturated fat to reduce cardiovascular risk.' },
    sugar:   { icon: '🧃', title: 'Hidden Sugar Warning', text: 'Sweetened drinks like Milo Dinosaur, teh tarik, and ice kachang can exceed your daily sugar limit in a single cup. Choose "siu dai" (less sweet) when ordering drinks.' },
    cal:     { icon: '⚡', title: 'Calorie Overflow', text: 'A typical Singapore hawker meal day can easily reach 2,500–3,000 kcal. Being mindful of portion sizes and reducing fried foods helps maintain a healthy weight.' },
    fat:     { icon: '🍳', title: 'Total Fat Intake', text: 'Fried dishes like char kway teow, goreng pisang, and mee goreng contribute significant fat. Balance with steamed or soup-based options like yong tau foo or congee.' },
    carbs:   { icon: '🌾', title: 'Carbohydrate Intake', text: 'Most hawker staples are carbohydrate-rich. Choosing smaller portions of rice or noodles, or mixed veg rice, can help manage overall carb intake.' },
    protein: { icon: '💪', title: 'Protein Intake', text: 'Good news — many hawker dishes provide adequate protein. Chicken, fish, and beancurd dishes are especially protein-rich relative to their calorie content.' },
  };

  const STORAGE_KEY = 'food-sim-tray-v1';

  // ── 2. STATE ──────────────────────────────────────────────────────────────

  const state = {
    tray: {
      breakfast: new Map(),
      lunch:     new Map(),
      dinner:    new Map(),
      snack:     new Map(),
    },
    activeSlot:     'breakfast',
    activeCategory: 'All',
    eduOpen:        false,
    resetPending:   false,
    resetTimer:     null,
  };

  // ── 3. COMPUTED ───────────────────────────────────────────────────────────

  function computeTotals() {
    const totals = { cal: 0, carbs: 0, protein: 0, fat: 0, satFat: 0, sodium: 0, sugar: 0 };
    for (const items of Object.values(state.tray)) {
      for (const [mealId, qty] of items) {
        const meal = MEALS.find(m => m.id === mealId);
        if (!meal) continue;
        for (const n of NUTRIENTS) totals[n] += meal[n] * qty;
      }
    }
    return totals;
  }

  function computeSlotCount(slot) {
    let count = 0;
    for (const qty of state.tray[slot].values()) count += qty;
    return count;
  }

  function computeSlotCal(slot) {
    let cal = 0;
    for (const [mealId, qty] of state.tray[slot]) {
      const meal = MEALS.find(m => m.id === mealId);
      if (meal) cal += meal.cal * qty;
    }
    return cal;
  }

  function getMealQty(mealId, slot) {
    return state.tray[slot].get(mealId) || 0;
  }

  function getFilteredMeals() {
    if (state.activeCategory === 'All') return MEALS;
    return MEALS.filter(m => m.category === state.activeCategory);
  }

  function hasTrayItems() {
    for (const items of Object.values(state.tray)) {
      if (items.size > 0) return true;
    }
    return false;
  }

  // ── 4. PERSISTENCE ───────────────────────────────────────────────────────

  function saveState() {
    const serialised = {};
    for (const [slot, map] of Object.entries(state.tray)) {
      if (map.size > 0) serialised[slot] = Object.fromEntries(map);
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialised)); } catch (_) {}
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return;
      for (const [slot, obj] of Object.entries(raw)) {
        if (state.tray[slot]) {
          state.tray[slot] = new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
        }
      }
    } catch (_) {}
  }

  // ── 5. DOM REFS ───────────────────────────────────────────────────────────

  const slotTabsEl    = document.getElementById('foodSlotTabs');
  const categoryRowEl = document.getElementById('foodCategoryRow');
  const mealGridEl    = document.getElementById('foodMealGrid');
  const trayEl        = document.getElementById('foodTray');
  const calHeroEl     = document.getElementById('foodCalHero');
  const summaryBarsEl = document.getElementById('foodSummaryBars');
  const eduToggleEl   = document.getElementById('foodEduToggle');
  const eduArrowEl    = document.getElementById('foodEduArrow');
  const eduBodyEl     = document.getElementById('foodEduBody');
  const resetBtnEl    = document.getElementById('foodResetBtn');

  // ── 6. RENDER ─────────────────────────────────────────────────────────────

  function render() {
    renderSlotTabs();
    renderMealGrid();
    renderTray();
    renderSummary();
    if (state.eduOpen) renderEducation();
  }

  function renderSlotTabs() {
    slotTabsEl.innerHTML = SLOTS.map(s => {
      const count = computeSlotCount(s.id);
      const cal   = computeSlotCal(s.id);
      const isActive = s.id === state.activeSlot;
      return `
        <button class="food-slot-tab${isActive ? ' active' : ''}" data-slot="${s.id}">
          <span class="food-slot-tab-emoji">${s.emoji}</span>
          <span class="food-slot-tab-label">${s.label}</span>
          <span class="food-slot-tab-count">${count > 0 ? count + ' item' + (count > 1 ? 's' : '') : '—'}</span>
          ${cal > 0 ? `<span class="food-slot-tab-cal">${cal} kcal</span>` : ''}
        </button>`;
    }).join('');
  }

  function renderCategoryPills() {
    categoryRowEl.innerHTML = CATEGORIES.map(cat => {
      const isActive = cat === state.activeCategory;
      return `<button class="food-cat-pill${isActive ? ' active' : ''}" data-cat="${cat}">${cat}</button>`;
    }).join('');
  }

  function renderMealGrid() {
    const meals = getFilteredMeals();
    if (meals.length === 0) {
      mealGridEl.innerHTML = '<div class="food-tray-empty">No items in this category.</div>';
      return;
    }
    mealGridEl.innerHTML = meals.map(meal => {
      const qty = getMealQty(meal.id, state.activeSlot);
      const isSelected = qty > 0;
      const imgClass = CAT_IMG_CLASS[meal.category] || '';
      return `
        <div class="food-meal-card${isSelected ? ' food-meal-selected' : ''}">
          <div class="food-meal-img ${imgClass}">
            ${meal.emoji}
            <span class="food-meal-cal-badge">${meal.cal} kcal</span>
          </div>
          <div class="food-meal-body">
            <div class="food-meal-name">${meal.name}</div>
            <div class="food-meal-serving">${meal.serving}</div>
            <div class="food-qty-row">
              <button class="food-qty-btn" data-sub="${meal.id}" aria-label="Remove one ${meal.name}">−</button>
              <span class="food-qty-num">${qty || '0'}</span>
              <button class="food-qty-btn food-qty-add" data-add="${meal.id}" aria-label="Add ${meal.name}">+</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTray() {
    if (!hasTrayItems()) {
      trayEl.innerHTML = '<div class="food-tray-empty">No meals added yet. Select a meal slot above and tap + to add dishes.</div>';
      return;
    }

    let html = '';
    let totalCal = 0;

    for (const slot of SLOTS) {
      const items = state.tray[slot.id];
      if (items.size === 0) continue;
      html += `<div class="food-tray-slot-label">${slot.emoji} ${slot.label}</div>`;
      for (const [mealId, qty] of items) {
        const meal = MEALS.find(m => m.id === mealId);
        if (!meal) continue;
        const itemCal = meal.cal * qty;
        totalCal += itemCal;
        html += `
          <div class="food-tray-item">
            <span class="food-tray-item-emoji">${meal.emoji}</span>
            <span class="food-tray-item-name">${meal.name}</span>
            <span class="food-tray-item-qty">×${qty}</span>
            <span class="food-tray-item-cal">${itemCal} kcal</span>
            <button class="food-tray-remove" data-tray-remove="${mealId}" data-slot="${slot.id}" aria-label="Remove ${meal.name}">✕</button>
          </div>`;
      }
    }

    html += `
      <div class="food-tray-total">
        <span class="food-tray-total-label">Total</span>
        <span class="food-tray-total-val">${totalCal} kcal</span>
      </div>`;

    trayEl.innerHTML = html;
  }

  function renderSummary() {
    const totals = computeTotals();
    calHeroEl.textContent = Math.round(totals.cal).toLocaleString();

    const bars = NUTRIENTS.filter(n => n !== 'cal').map(n => renderBar(n, totals)).join('');
    summaryBarsEl.innerHTML = renderBar('cal', totals, true) + bars;
  }

  function renderBar(nutrient, totals, isCalorie) {
    const guideline = MOH[nutrient].value;
    const current   = Math.round(totals[nutrient]);
    const rawPct    = guideline > 0 ? (current / guideline) * 100 : 0;
    const fillPct   = Math.min(rawPct, 100);

    let barClass    = 'food-bar-ok';
    let valClass    = '';
    let statusClass = 'food-status-ok';
    let statusText  = '';

    if (rawPct >= 100) {
      barClass = 'food-bar-over';
      valClass = 'food-values-over';
      statusClass = 'food-status-over';
      statusText = rawPct >= 130
        ? `${Math.round(rawPct - 100)}% over daily limit`
        : 'Over daily limit';
    } else if (rawPct >= 75) {
      barClass = 'food-bar-warn';
      valClass = 'food-values-warn';
      statusClass = 'food-status-warn';
      statusText = 'Approaching daily limit';
    } else if (rawPct > 0) {
      statusText = 'Within limit';
    }

    const overflowMarker = rawPct > 100 ? '<div class="food-bar-overflow-marker"></div>' : '';

    return `
      <div class="food-nutrient-row">
        <div class="food-nutrient-header">
          <span class="food-nutrient-label">${MOH[nutrient].label}</span>
          <span class="food-nutrient-values ${valClass}">${current.toLocaleString()} / ${guideline.toLocaleString()} ${MOH[nutrient].unit}</span>
        </div>
        <div class="food-bar-track">
          <div class="food-bar-fill ${barClass}" style="width:${fillPct}%"></div>
          ${overflowMarker}
        </div>
        ${statusText ? `<div class="food-bar-status ${statusClass}">${statusText}</div>` : ''}
      </div>`;
  }

  function renderEducation() {
    const totals = computeTotals();
    let html = '';

    // Over-limit tips
    const overNutrients = NUTRIENTS.filter(n => {
      const pct = (totals[n] / MOH[n].value) * 100;
      return pct >= 90;
    });

    if (overNutrients.length === 0 && !hasTrayItems()) {
      html = '<div class="food-edu-tip food-edu-tip-ok"><span class="food-edu-tip-icon">✅</span><span>Add some meals to see personalised nutrition tips.</span></div>';
    } else if (overNutrients.length === 0) {
      html = '<div class="food-edu-tip food-edu-tip-ok"><span class="food-edu-tip-icon">✅</span><span>Great balance! All nutrients are within recommended daily limits.</span></div>';
    } else {
      overNutrients.forEach(n => {
        const pct = Math.round((totals[n] / MOH[n].value) * 100);
        const tip = EDU_TIPS[n];
        const tipClass = pct >= 100 ? 'food-edu-tip-over' : 'food-edu-tip-warn';
        html += `
          <div class="food-edu-tip ${tipClass}">
            <span class="food-edu-tip-icon">${tip.icon}</span>
            <span><strong>${tip.title}</strong> (${pct}% of daily limit)<br>${tip.text}</span>
          </div>`;
      });
    }

    // Highest sodium dish callout
    let highSodiumMeal = null;
    let highSodiumVal = 0;
    for (const items of Object.values(state.tray)) {
      for (const [mealId] of items) {
        const meal = MEALS.find(m => m.id === mealId);
        if (meal && meal.sodium > highSodiumVal) {
          highSodiumVal = meal.sodium;
          highSodiumMeal = meal;
        }
      }
    }
    if (highSodiumMeal && highSodiumMeal.sodium >= 1000) {
      html += `
        <div class="food-edu-tip">
          <span class="food-edu-tip-icon">🧂</span>
          <span>Did you know? <strong>${highSodiumMeal.name}</strong> has ${highSodiumMeal.sodium} mg sodium — that's ${Math.round((highSodiumMeal.sodium / 2000) * 100)}% of your daily limit in one dish.</span>
        </div>`;
    }

    html += `<div class="food-moh-note">Source: Singapore Health Promotion Board (HPB) / Ministry of Health (MOH). Nutritional data is approximate and based on typical hawker serving sizes.</div>`;
    eduBodyEl.innerHTML = html;
  }

  // ── 7. EVENT HANDLERS ─────────────────────────────────────────────────────

  function onSlotTabClick(slot) {
    state.activeSlot = slot;
    render();
  }

  function onCategoryClick(cat) {
    state.activeCategory = cat;
    renderCategoryPills();
    renderMealGrid();
  }

  function onAddMeal(mealId) {
    const slot = state.tray[state.activeSlot];
    slot.set(mealId, (slot.get(mealId) || 0) + 1);
    saveState();
    render();
  }

  function onRemoveMeal(mealId) {
    const slot = state.tray[state.activeSlot];
    const current = slot.get(mealId) || 0;
    if (current <= 1) slot.delete(mealId);
    else slot.set(mealId, current - 1);
    saveState();
    render();
  }

  function onRemoveTrayItem(mealId, slotId) {
    state.tray[slotId].delete(mealId);
    saveState();
    render();
  }

  function onReset() {
    if (state.resetPending) {
      // Second tap — do the reset
      clearTimeout(state.resetTimer);
      state.resetPending = false;
      resetBtnEl.textContent = 'Clear All';
      for (const map of Object.values(state.tray)) map.clear();
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      render();
    } else {
      // First tap — ask for confirmation
      state.resetPending = true;
      resetBtnEl.textContent = 'Tap again to clear';
      state.resetTimer = setTimeout(() => {
        state.resetPending = false;
        resetBtnEl.textContent = 'Clear All';
      }, 3000);
    }
  }

  function onToggleEducation() {
    state.eduOpen = !state.eduOpen;
    eduArrowEl.textContent = state.eduOpen ? '▼' : '▶';
    if (state.eduOpen) {
      eduBodyEl.classList.remove('hidden');
      renderEducation();
    } else {
      eduBodyEl.classList.add('hidden');
    }
  }

  // ── 8. EVENT WIRING ───────────────────────────────────────────────────────

  // Slot tab delegation
  slotTabsEl.addEventListener('click', e => {
    const tab = e.target.closest('[data-slot]');
    if (tab) onSlotTabClick(tab.dataset.slot);
  });

  // Category pill delegation
  categoryRowEl.addEventListener('click', e => {
    const pill = e.target.closest('[data-cat]');
    if (pill) onCategoryClick(pill.dataset.cat);
  });

  // Meal grid delegation
  mealGridEl.addEventListener('click', e => {
    const addBtn = e.target.closest('[data-add]');
    const subBtn = e.target.closest('[data-sub]');
    if (addBtn) onAddMeal(addBtn.dataset.add);
    else if (subBtn) onRemoveMeal(subBtn.dataset.sub);
  });

  // Tray delegation
  trayEl.addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-tray-remove]');
    if (removeBtn) onRemoveTrayItem(removeBtn.dataset.trayRemove, removeBtn.dataset.slot);
  });

  eduToggleEl.addEventListener('click', onToggleEducation);
  resetBtnEl.addEventListener('click', onReset);

  // ── 9. INIT ───────────────────────────────────────────────────────────────

  loadState();
  renderCategoryPills();
  render();

})();
