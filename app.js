/* ===== Детективное агентство «Логика» — движок ===== */
'use strict';

const STORE_KEY = 'mathDetectiveV1';
let store = loadStore();
let safeModalQueue = [];
let examTimer = null;

/* ---------- утилиты ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function norm(v) {
  return String(v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}
function normHard(v) {
  return String(v).toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]/g, '');
}
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* повреждённые данные — начинаем с чистого листа */ }
  return { profiles: {}, currentId: null, admin: { pin: null, prizes: {} }, ui: { theme: 'desk' } };
}
function saveStore() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
function P() { return store.profiles[store.currentId] || null; }
function newProfile(name, emoji) {
  const id = 'p' + Date.now();
  store.profiles[id] = {
    name, emoji, created: today(), briefed: false,
    points: 0,
    problems: {},   // 'c1/p1' -> {status:'solved'|'reviewed', hints, solution, got, first, lastDay}
    notes: {},      // 'c1/p7' -> черновик агента (текст), 'c1/boss' -> черновик главаря
    bosses: {},     // c1 -> {done:true, got}
    earlyUnlock: {},// c2 -> true
    letters: [],    // индексы открытых букв тайного слова
    mysterySolved: false,
    achievements: [],
    activity: [],
    views: {},      // 'c1/p1' -> дата первого просмотра
    exam: { best: null, started: null, answers: {}, submitted: false },
    safesOpened: []
  };
  store.currentId = id;
  saveStore();
}
function applyTheme() {
  store.ui = store.ui || {};
  if (!['desk', 'night', 'day'].includes(store.ui.theme)) store.ui.theme = 'desk';
  document.body.dataset.theme = store.ui.theme;
}
const THEMES = [
  { id: 'desk', name: 'Классическая доска', desc: 'бумага, кнопки и красная нить', colors: ['#17130e', '#f3ecdc', '#c43a2f'] },
  { id: 'night', name: 'Ночной неон', desc: 'тёмный, современный', colors: ['#0d1017', '#1b2231', '#8b9dff'] },
  { id: 'day', name: 'Светлый и чистый', desc: 'минимализм, для дня', colors: ['#eef1f8', '#ffffff', '#5a5fd6'] }
];
function titleFor(points) {
  let t = DATA.titles[0].name;
  for (const x of DATA.titles) if (points >= x.min) t = x.name;
  return t;
}

/* ---------- прогресс по задачам ---------- */
function entryKey(cid, pid) { return cid + '/' + pid; }
function getEntry(cid, pid) { const p = P(); return p ? p.problems[entryKey(cid, pid)] || null : null; }
function setEntry(cid, pid, obj) { P().problems[entryKey(cid, pid)] = obj; saveStore(); }
function getNote(key) { const p = P(); return (p.notes && p.notes[key]) || ''; }
function saveNote(key, text) { const p = P(); if (!p.notes) p.notes = {}; p.notes[key] = text; saveStore(); }
function caseStats(c) {
  const closed = c.problems.filter(pr => getEntry(c.id, pr.id)).length;
  return { closed, total: c.problems.length, boss: !!(P().bosses[c.id] && P().bosses[c.id].done) };
}
function caseUnlocked(idx) {
  if (idx === 0) return true;
  const prev = DATA.caseList[idx - 1];
  return caseStats(prev).boss || !!(P().earlyUnlock[DATA.caseList[idx].id]);
}
function factorFor(hints) { return hints === 0 ? 1 : (hints === 1 ? 0.66 : 0.33); }

/* ---------- баллы и сейфы ---------- */
function addPoints(n, silent) {
  const p = P();
  p.points += n;
  saveStore();
  if (!silent) toast('+' + n + ' 🪙 за работу детектива');
  checkSafes();
}
function checkSafes() {
  const p = P();
  DATA.safes.forEach((thr, i) => {
    if (p.points >= thr && p.safesOpened.indexOf(i) < 0) {
      p.safesOpened.push(i);
      safeModalQueue.push(i);
    }
  });
  saveStore();
  if (safeModalQueue.length) showNextSafe();
}
function safePrize(i) {
  const custom = store.admin.prizes[i];
  return custom && custom.text ? custom : { text: 'Приз №' + (i + 1) + ' — подойди к родителям за получением!', img: '' };
}
function showNextSafe() {
  if ($('modal-root').classList.contains('show')) return; // дождёмся закрытия текущего окна
  const i = safeModalQueue.shift();
  if (i === undefined) return;
  const prize = safePrize(i);
  confetti();
  showModal(`
    <h2>Сейф открыт!</h2>
    <div class="big">🗄️✨</div>
    <p>Ты набрал(а) ${DATA.safes[i]} 🪙 — сейф №${i + 1} поддался!</p>
    <div style="background:#f7efd9;border:2px dashed var(--gold);border-radius:8px;padding:14px;margin:10px 0;">
      <div style="font-size:2em">🎁</div>
      <p style="font-size:1.15em"><b>${esc(prize.text)}</b></p>
      ${prize.img ? `<img src="${esc(prize.img)}" style="max-width:100%;border-radius:8px;">` : ''}
      <p class="small" style="color:var(--ink-soft)">Получи приз у родителей и возвращайся в агентство!</p>
    </div>
    <button class="gold" onclick="closeModal()">Продолжить расследование</button>
  `);
}

/* ---------- достижения ---------- */
function unlockAch(id) {
  const p = P();
  if (!p || p.achievements.indexOf(id) >= 0) return;
  const a = DATA.achievements.find(x => x.id === id);
  if (!a) return;
  p.achievements.push(id);
  saveStore();
  toast(`${a.emoji} Награда детектива: «${a.title}»`, 'ach');
}
function checkStreak() {
  const p = P();
  if (!p) return;
  const days = p.activity.slice().sort();
  if (days.length < 3) return;
  let run = 1, best = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]), cur = new Date(days[i]);
    const diff = (cur - prev) / 86400000;
    run = (diff === 1) ? run + 1 : 1;
    if (run > best) best = run;
  }
  if (best >= 3) unlockAch('a_streak3');
}
function touchActivity() {
  const p = P();
  if (!p) return;
  if (p.activity.indexOf(today()) < 0) { p.activity.push(today()); saveStore(); }
  checkStreak();
}
function countCleanSolved() {
  const p = P();
  return Object.keys(p.problems).filter(k => {
    const e = p.problems[k];
    return e.status === 'solved' && e.hints === 0 && !e.solution;
  }).length;
}
function afterProblemSolved(cid, pid, hints, sawSolution) {
  const p = P();
  unlockAch('a_first');
  if (countCleanSolved() >= 10) unlockAch('a_ten_clean');
  const firstView = p.views[entryKey(cid, pid)];
  if (firstView && firstView < today()) unlockAch('a_comeback');
  const c = DATA.caseList.find(x => x.id === cid);
  if (c) {
    const st = caseStats(c);
    if (st.closed === st.total) {
      const allClean = c.problems.every(pr => {
        const e = p.problems[entryKey(cid, pr.id)];
        return e && e.status === 'solved' && e.hints === 0 && !e.solution;
      });
      if (allClean) unlockAch('a_no_hints');
    }
  }
}

/* ---------- маршрутизация ---------- */
function route() {
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  const h = location.hash.replace(/^#/, '');
  const p = P();
  if (!p) { renderProfiles(); return; }
  touchActivity();
  if (!p.briefed && h !== 'admin' && h !== 'brief') { renderBrief(); return; }
  if (h === 'brief') { renderBrief(); return; }
  if (h === '' || h === 'map') renderMap();
  else if (h.startsWith('case/')) renderCase(h.split('/')[1]);
  else if (h === 'exam') renderExam();
  else if (h === 'mystery') renderMystery();
  else if (h === 'ach') renderAch();
  else if (h === 'admin') renderAdmin();
  else if (h === 'profile') renderProfilePage();
  else renderMap();
}
window.addEventListener('hashchange', route);

/* ---------- шапка ---------- */
function headerHtml(active) {
  const p = P();
  const nextSafeIdx = DATA.safes.findIndex((thr, i) => p.safesOpened.indexOf(i) < 0);
  let safeBar = '';
  if (nextSafeIdx >= 0) {
    const prev = nextSafeIdx === 0 ? 0 : DATA.safes[nextSafeIdx - 1];
    const thr = DATA.safes[nextSafeIdx];
    const pct = Math.min(100, Math.round((p.points - prev) / (thr - prev) * 100));
    safeBar = `
      <div class="safe-progress">
        <span>🗄️ Сейф №${nextSafeIdx + 1}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <span>${p.points} / ${thr} 🪙</span>
      </div>`;
  } else {
    safeBar = `<div class="safe-progress"><span>🗄️ Все сейфы вскрыты — ты легенда агентства!</span></div>`;
  }
  const links = [['map', '🗺️ Карта дел'], ['brief', '📣 Брифинг'], ['exam', '📜 Экзамен'], ['mystery', '🗝️ Тайна'], ['ach', '🏅 Награды']];
  const nav = links.map(([id, label]) => `<a href="#${id}" ${active === id ? 'style="font-weight:bold"' : ''}>${label}</a>`).join(' · ');
  return `
    <div class="topbar">
      <span class="brand"><span class="em">🕵️</span> Агентство «Логика»</span>
      <span class="agent-chip">${p.emoji} <b>${esc(p.name)}</b> · ${titleFor(p.points)}</span>
      <span class="spacer"></span>
      <span class="points-chip"><span class="coin">🪙</span> ${p.points}</span>
    </div>
    <div style="margin-bottom:8px;" class="small">${nav} · <a href="#profile">👤 Профиль</a> · <a href="#admin">🔑 Родителям</a></div>
    ${safeBar}`;
}
function footerHtml() {
  return `<footer class="site-foot">${DATA.credits}<br>Прогресс хранится в этом браузере. Кнопка «сохранить в файл» — на странице профиля.</footer>`;
}

/* ---------- экран профилей ---------- */
function renderProfiles() {
  const list = Object.keys(store.profiles).map(id => {
    const p = store.profiles[id];
    return `<div class="profile-card" data-act="pickProfile" data-arg="${id}">
      <div class="avatar">${p.emoji}</div>
      <b>${esc(p.name)}</b><br><small>${titleFor(p.points)} · 🪙 ${p.points}</small>
    </div>`;
  }).join('');
  $('app').innerHTML = `
    <div class="topbar"><span class="brand"><span class="em">🕵️</span> Агентство «Логика»</span></div>
    <p class="board-intro">Математическое детективное агентство. Выбери своего агента — или заведи нового.</p>
    <div class="profile-grid">${list || '<span class="muted">Пока никто не зачислен в агентство.</span>'}</div>
    <div class="paper" style="max-width:460px">
      <h4>Новый агент</h4>
      <p class="small">Как тебя записать в документах агентства?</p>
      <input type="text" id="np-name" maxlength="20" placeholder="Имя детектива" style="width:100%">
      <div class="emoji-pick" id="np-emoji"></div>
      <button class="gold" data-act="createProfile">Зачислить в агентство ✒️</button>
    </div>
    ${footerHtml()}`;
  const avatars = ['🕵️‍♀️', '🕵️', '🦉', '🐈‍⬛', '🦊', '🐺', '🧐', '👩‍✈️', '🐢', '🦅'];
  const box = $('np-emoji');
  box.innerHTML = avatars.map((a, i) => `<button data-act="pickEmoji" data-arg="${i}" class="${i === 0 ? 'sel' : ''}">${a}</button>`).join('');
  box.dataset.sel = '0';
}

/* ---------- брифинг (вербовка) ---------- */
function renderBrief() {
  const p = P();
  const titlesList = DATA.titles.map(t => t.name).join(' → ');
  $('app').innerHTML = `
  <div class="topbar">
    <span class="brand"><span class="em">🕵️</span> Агентство «Логика»</span>
    <span class="spacer"></span>
    <span class="agent-chip">${p.emoji} <b>${esc(p.name)}</b></span>
  </div>
  <div class="paper" style="max-width:640px;margin:10px auto 0;transform:rotate(-.4deg)">
    <div style="text-align:right;color:var(--ink-soft);font-size:.85em">ДЕЛО №0 · ВЕРБОВКА · СЕКРЕТНО</div>
    <h4 style="font-size:1.2em">Письмо новому агенту</h4>
    <p>Привет, агент ${esc(p.name)}. Меня зовут Шеф. Я стою во главе детективного агентства «Логика» — самой незаметной организации в этом городе.</p>
    <p>Двадцать лет назад здесь появились противники, перед которыми бессильна обычная полиция: фальшивомонетчики, чьи монеты вводят в заблуждение даже точные весы; свидетели, которые не говорят правды <b>никогда</b>; оборотни, меняющие облик; запертые комнаты, из которых «невозможно выйти», и двенадцать монет, из-за которых взрослые детективы поседели.</p>
    <p>Против всех них есть одно оружие — <b>мышление</b>. Настоящий детектив не сдаётся, когда ответ «где-то там»: он задаёт вопросы, пробует, ошибается, пробует снова — и раскрывает дело.</p>
    <p>Ты зачислен(а) в агентство. Прочти правила — и выходи на карту дел.</p>
    <div style="text-align:right;font-style:italic;color:var(--ink-soft)">— Шеф 🔦</div>
  </div>
  <div class="paper" style="max-width:640px;margin:14px auto;transform:rotate(.3deg)">
    <h4>Как устроено каждое дело</h4>
    <ul style="margin:6px 0;padding-left:20px">
      <li><b>Брифинг</b> — короткая теория: два-три приёма на будущее.</li>
      <li><b>Разборы</b> — три задачи, которые Шеф решает вместе с тобой. Сначала подумай сам(а)!</li>
      <li><b>Улики</b> — двенадцать задач, сложность растёт от разминки до десерта.</li>
      <li><b>Главарь</b> — испытание в конце дела. Победил(а) — дело закрыто, штамп поставлен, буква тайного слова у тебя.</li>
    </ul>
    <h4 style="margin-top:14px">Правила детектива</h4>
    <ul style="margin:6px 0;padding-left:20px">
      <li>🧠 <b>Ошибка — это улика, а не провал.</b> Неверный ответ ничего не отнимает: пробуй ещё столько, сколько нужно.</li>
      <li>💡 <b>Наводки — законный инструмент.</b> Подсмотрел(а) идею и добил(а) — тоже победа: с одной наводкой задача даёт ⅔ монет, с двумя — треть.</li>
      <li>🔓 <b>Решение Шефа откроется всегда</b> — но тогда задача закроется без монет. Сначала попробуй сам(а).</li>
      <li>📝 <b>«Бумажные» задачи</b> — значок 📝: ответ в них не число, а способ. Веди черновик в блокноте под задачей и жми «Я решил(а) сам(а)!». Честное слово детектива — главный закон агентства.</li>
      <li>🗄️ <b>Монеты открывают сейфы.</b> В сейфах лежат настоящие призы — за ними идти к родителям. Родители настроили призы на своей странице (🔑 внизу).</li>
    </ul>
    <h4 style="margin-top:14px">Что ещё можно заслужить</h4>
    <ul style="margin:6px 0;padding-left:20px">
      <li>⭐ Звания: ${titlesList}.</li>
      <li>🏅 ${DATA.achievements.length} наград детектива — от «Первой улики» до «Тайны агентства».</li>
      <li>🗝️ Буквы тайного слова из шести букв — за главарей и экзамен. Соберёшь все — узнаешь главный секрет агентства.</li>
      <li>📜 Экзамен: 8 задач и таймер на 90 минут — точная репетиция школьного этапа Всероссийской олимпиады.</li>
    </ul>
    <p class="note" style="margin-top:12px">И последнее. Здесь не бывает «слишком глупых вопросов» и «слишком странных идей»: все великие раскрытия начинались со странной идеи в черновике. Агентство верит в тебя.</p>
  </div>
  <div style="text-align:center;margin:18px 0 30px">
    <button class="gold" style="font-size:1.15em;padding:12px 26px" data-act="briefGo">Приступить к расследованию 🕵️</button>
    <div style="margin-top:8px"><button class="linklike small" data-act="briefSkip">прочитаю подробнее позже — сразу к делам</button></div>
  </div>
  ${footerHtml()}`;
}

function renderMap() {
  const p = P();
  let cards = '';
  DATA.caseList.forEach((c, idx) => {
    if (!caseUnlocked(idx)) {
      cards += `
      <div class="case-card">
        <div class="pin">🔒</div>
        <div class="case-paper" style="opacity:.75">
          <h3>Дело №${c.num}. ${esc(c.title)}</h3>
          <div class="case-sub">${esc(c.subtitle)}</div>
          <p class="small">Шеф советует сначала закрыть дело №${DATA.caseList[idx - 1].num}. Но смелых агентство не держит.</p>
          <button class="ghost" data-act="earlyUnlock" data-arg="${c.id}">Открыть досрочно 🔓</button>
        </div>
      </div>`;
      return;
    }
    const st = caseStats(c);
    const pct = Math.round(st.closed / st.total * 100);
    cards += `
      <div class="case-card">
        <div class="pin ${st.boss ? 'done' : ''}">${st.boss ? '✅' : c.emoji}</div>
        <div class="case-paper">
          ${st.boss ? '<div class="stamp ok">Дело закрыто</div>' : ''}
          <h3>Дело №${c.num}. ${esc(c.title)}</h3>
          <div class="case-sub">${esc(c.subtitle)}</div>
          <div class="case-meta">
            <div class="progress-mini"><i style="width:${pct}%"></i></div>
            <span>${st.closed}/${st.total} задач</span>
            <span>${st.boss ? '🌟' : '⚔️'} ${st.boss ? 'главарь повержен' : 'главарь ждёт'}</span>
            <button class="primary" data-act="goto" data-arg="#case/${c.id}">Открыть дело</button>
          </div>
        </div>
      </div>`;
  });
  const safesRow = DATA.safes.map((thr, i) => {
    const opened = p.safesOpened.indexOf(i) >= 0;
    return `<div class="safe-box ${opened ? 'open' : ''}" title="${thr} 🪙" ${opened ? `data-act="showSafe" data-arg="${i}"` : ''}>${opened ? '🎁' : '🔒'}</div>`;
  }).join('');
  $('app').innerHTML = headerHtml('map') + `
    <p class="board-intro">Стена расследований. Иди по красной нити: теория → разборы → задачи → главарь. Сейфы открываются сами, когда набираются монеты 🪙.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">${safesRow}</div>
    <div class="path">${cards}</div>
    <div class="paper">
      <h4>Экзамен агентства 📜</h4>
      <p>Когда почувствуешь силу — потренируй настоящий школьный этап ВсОШ: 8 задач, 90 минут. <a href="#exam">В экзаменационный зал</a>.</p>
    </div>
    ${footerHtml()}`;
}

/* ---------- страница дела ---------- */
function renderCase(cid) {
  const c = DATA.caseList.find(x => x.id === cid);
  if (!c) { location.hash = 'map'; return; }
  const cIdx = DATA.caseList.indexOf(c);
  if (!caseUnlocked(cIdx)) { location.hash = 'map'; return; }
  const p = P();
  const st = caseStats(c);
  const bossNeed = Math.max(1, c.problems.length - 3);
  const bossLocked = st.closed < bossNeed;

  const examples = c.examples.map((e, i) => `
    <div class="problem">
      <div class="problem-top"><span class="badge-num">РАЗБОР ${i + 1}</span></div>
      <p class="stmt">${e.statement}</p>
      <details><summary>Показать решение шефа</summary><div class="solution-item">${e.solution}</div></details>
    </div>`).join('');

  const problems = c.problems.map((pr, i) => {
    const e = getEntry(c.id, pr.id);
    if (!p.views[entryKey(c.id, pr.id)]) { p.views[entryKey(c.id, pr.id)] = today(); }
    const closed = !!(e && e.status);
    const stars = closed ? (e.status === 'solved' ? (e.hints === 0 && !e.solution ? '⭐⭐⭐' : (e.hints === 1 ? '⭐⭐' : '⭐')) : '📖') : '';
    let controls = '';
    if (!closed) {
      const hintsShown = e ? e.hints : 0;
      if (pr.type === 'answer') {
        controls = `
          <div class="answer-row">
            <input type="text" id="ans-${pr.id}" placeholder="${pr.answerNote || 'ответ'}" autocomplete="off">
            <button class="gold" data-act="checkAnswer" data-arg="${c.id}|${pr.id}">Проверить</button>
            <span class="points-note">до ${pr.points} 🪙</span>
          </div>
          <div id="res-${pr.id}"></div>`;
      } else {
        controls = `
          <div class="open-note">Ответ здесь — не число, а <b>способ или рассуждение</b>. Веди черновик в блокноте ниже — как настоящий детектив. Потом открой <b>решение шефа</b>, сравни ход мыслей — и честно нажми кнопку.</div>
          <textarea data-note="${c.id}/${pr.id}" placeholder="Тут твой черновик: пиши мысли, догадки, попытки — даже неполные. Всё пригодится шефу!">${esc(getNote(c.id + '/' + pr.id))}</textarea>
          <div class="answer-row" id="open-${pr.id}">
            <button class="gold" data-act="selfSolved" data-arg="${c.id}|${pr.id}">Я решил(а) сам(а)! ✋</button>
            <span class="points-note">до ${pr.points} 🪙</span>
          </div>`;
      }
    } else {
      controls = `<div class="answer-row"><span class="${e.status === 'solved' ? 'result-ok' : 'badge-rev'}">${e.status === 'solved' ? '✔ Раскрыто' : '▪ Разобрано с шефом'} · +${e.got} 🪙</span></div>`;
      if (pr.type === 'open') {
        const note = getNote(c.id + '/' + pr.id);
        if (note) controls += `<div class="small" style="margin-top:6px;color:var(--ink-soft)">Твой черновик: <i>${esc(note)}</i></div>`;
      }
    }
    const entryHints = e ? e.hints : 0;
    const entrySol = e ? e.solution : false;
    return `
    <div class="problem ${closed ? (e.status === 'solved' ? 'solved' : 'reviewed') : ''}">
      <div class="problem-top">
        <span class="badge-num">УЛИКА ${i + 1}</span>
        ${pr.type === 'open' ? '<span class="badge-num badge-paper">📝 бумага</span>' : '<span class="badge-num" style="background:#5c5342;">🔢 ответ — число</span>'}
        ${stars ? `<span class="badge-star">${stars}</span>` : ''}
        ${closed ? `<span class="badge-ok">закрыто</span>` : ''}
      </div>
      <p class="stmt">${pr.statement}</p>
      <div class="hints">
        ${entryHints >= 1 || !closed ? `<button class="small-btn ghost" data-act="hint" data-arg="${c.id}|${pr.id}|1" ${closed ? 'disabled' : ''}>💡 Наводка 1</button>` : ''}
        ${entryHints >= 2 || !closed ? `<button class="small-btn ghost" data-act="hint" data-arg="${c.id}|${pr.id}|2" ${closed ? 'disabled' : ''}>💡 Наводка 2</button>` : ''}
        <button class="small-btn ghost" data-act="viewSolution" data-arg="${c.id}|${pr.id}">🔓 Показать решение</button>
      </div>
      <div id="hints-${pr.id}">
        ${entryHints >= 1 && pr.hint1 ? `<div class="hint-item"><b>Наводка 1.</b> ${pr.hint1}</div>` : ''}
        ${entryHints >= 2 && pr.hint2 ? `<div class="hint-item"><b>Наводка 2.</b> ${pr.hint2}</div>` : ''}
        ${entrySol ? `<div class="solution-item"><b>Решение.</b> ${pr.solution}</div>` : ''}
      </div>
      ${controls}
    </div>`;
  }).join('');
  saveStore();

  const boss = c.boss;
  const bossDone = st.boss;
  let bossHtml;
  if (bossLocked) {
    bossHtml = `
    <div class="boss" style="opacity:.7">
      <h3>${esc(boss.title)}</h3>
      <p>Главарь появится, когда ты закроешь хотя бы ${bossNeed} из ${c.problems.length} улик (сейчас ${st.closed}). Решение можно закрыть и разбором с шефом — главное вникнуть.</p>
    </div>`;
  } else {
    bossHtml = `
    <div class="boss">
      <h3>${esc(boss.title)} ${bossDone ? '· ПОВЕРЖЕН ✅' : ''}</h3>
      <p>${boss.statement}</p>
      <p class="small" style="color:#e8c9a0;">Главарь — «бумажная» задача: ответ не число, а рассуждение. Веди план поимки в блокноте ниже, при нужде сверься с наводками и решением — потом жми кнопку победы.</p>
      <p class="boss-reward">Награда: до ${boss.points} 🪙 + буква тайного слова 🗝️</p>
      ${bossDone ? '' : `<textarea data-note="${c.id}/boss" placeholder="План поимки главаря: идеи, расчёты, шаги…">${esc(getNote(c.id + '/boss'))}</textarea>`}
      ${bossDone && getNote(c.id + '/boss') ? `<div class="small" style="color:#e8c9a0">Твой черновик: <i>${esc(getNote(c.id + '/boss'))}</i></div>` : ''}
      ${bossDone ? '' : `
      <div class="hints" style="margin-top:10px">
        <button class="small-btn ghost" data-act="bossHint" data-arg="${c.id}|1">💡 Наводка 1</button>
        <button class="small-btn ghost" data-act="bossHint" data-arg="${c.id}|2">💡 Наводка 2</button>
        <button class="small-btn ghost" data-act="bossSolution" data-arg="${c.id}">🔓 Решение</button>
      </div>
      <div id="boss-hints"></div>
      <div class="answer-row" style="margin-top:12px">
        <button class="gold" data-act="bossWin" data-arg="${c.id}">Я победил(а) главаря! 🏆</button>
        <button class="ghost" data-act="bossReview" data-arg="${c.id}">Разобрал(а) разбор — засчитать</button>
      </div>`}
    </div>`;
  }

  $('app').innerHTML = headerHtml() + `
    <div class="case-head">
      <h2>Дело №${c.num}. ${esc(c.title)}</h2>
      <span class="backlink"><a href="#map">← на карту дел</a></span>
    </div>
    <div class="paper">
      <h4>Брифинг · ${esc(c.subtitle)}</h4>
      <p>${c.intro}</p>
      <div class="theory-box">${c.theory.map(t => '<p style="margin:6px 0">' + t + '</p>').join('')}</div>
    </div>
    <div class="paper">
      <h4>Разборы с шефом</h4>
      <p class="note">Сначала подумай над разбором сам(а) — потом открывай решение.</p>
    </div>
    ${examples}
    <div class="paper"><h4>Улики — решай по порядку, сложность растёт</h4>
    <p class="note">Подсказки не портят репутацию: подсмотрел идею и добил — тоже победа (просто чуть меньше монет). Неверный ответ ничем не наказывается — пробуй ещё!</p></div>
    ${problems}
    ${bossHtml}
    ${bossDone ? `<div class="paper" style="text-align:center"><h4>ШТАМП: ДЕЛО №${c.num} ЗАКРЫТО</h4><p>Буква тайного слова получена — загляни на страницу <a href="#mystery">Тайны</a>.</p></div>` : ''}
    ${footerHtml()}`;
}

/* ---------- действия с задачами ---------- */
function hintPressed(cid, pid, level) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
  if (e.hints >= level) return;
  e.hints = level;
  setEntry(cid, pid, e);
  renderCase(cid);
}
function solutionPressed(cid, pid) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  showModal(`<h2>Открыть решение?</h2>
    <p>Шеф раскроет всё до конца — задача закроется с 0 монет, но дело двинется дальше. Сначала попробуй наводки!</p>
    <button class="gold" data-act="confirmSolution" data-arg="${cid}|${pid}">Показать решение</button>
    <button data-act="closeModal">Я ещё подумаю</button>`);
}
function confirmSolution(cid, pid) {
  const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
  if (!e.status) { e.status = 'reviewed'; }
  e.solution = true;
  e.got = 0;
  setEntry(cid, pid, e);
  closeModal();
  renderCase(cid);
}
function checkAnswer(cid, pid) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  const val = $('ans-' + pid).value;
  const ok = pr.answers.some(a => normHard(a) === normHard(val)) ||
             pr.answers.some(a => norm(a) === norm(val));
  const box = $('res-' + pid);
  if (ok) {
    const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
    const got = Math.round(pr.points * factorFor(e.hints || 0));
    e.status = 'solved';
    e.got = Math.max(e.got || 0, got);
    setEntry(cid, pid, e);
    addPoints(got);
    afterProblemSolved(cid, pid, e.hints, false);
    renderCase(cid);
  } else {
    box.innerHTML = '<span class="result-bad">Пока не сходится. Попробуй ещё раз — ошибаться здесь не стыдно!</span>';
    $('ans-' + pid).select();
  }
}
function selfSolved(cid, pid, force) {
  const c = DATA.caseList.find(x => x.id === cid);
  const pr = c.problems.find(x => x.id === pid);
  const ta = document.querySelector(`textarea[data-note="${cid}/${pid}"]`);
  const note = ta ? ta.value : getNote(cid + '/' + pid);
  if (note && note.trim()) saveNote(cid + '/' + pid, note);
  if (!force && (!note || note.trim().length < 10)) {
    showModal(`<h2>Сначала — черновик!</h2>
      <p>Шеф просит записать хотя бы пару строк: как ты рассуждал(а)? Без записи он не увидит красоту мысли и не сможет рассказать родителям, какая ты умница.</p>
      <button class="gold" data-act="closeModal">Хорошо, запишу</button>
      <button class="ghost" data-act="selfSolvedForce" data-arg="${cid}|${pid}">Всё равно засчитать</button>`);
    return;
  }
  const e = getEntry(cid, pid) || { status: null, hints: 0, solution: false, got: 0 };
  const got = Math.round(pr.points * factorFor(e.hints || 0));
  e.status = 'solved';
  e.got = got;
  setEntry(cid, pid, e);
  addPoints(got);
  afterProblemSolved(cid, pid, e.hints, false);
  closeModal();
  toast('Честное слово детектива принято!');
  renderCase(cid);
}

/* ---------- главарь ---------- */
function bossHintPressed(cid, level) {
  const c = DATA.caseList.find(x => x.id === cid);
  const box = $('boss-hints');
  const item = level === 1
    ? `<div class="hint-item"><b>Наводка 1.</b> ${c.boss.hint1}</div>`
    : `<div class="hint-item"><b>Наводка 2.</b> ${c.boss.hint2}</div>`;
  box.innerHTML += item;
}
function bossSolutionPressed(cid) {
  const c = DATA.caseList.find(x => x.id === cid);
  $('boss-hints').innerHTML += `<div class="solution-item"><b>Решение.</b> ${c.boss.solution}</div>`;
}
function bossWin(cid, reviewed, force) {
  const c = DATA.caseList.find(x => x.id === cid);
  const p = P();
  if (p.bosses[cid] && p.bosses[cid].done) return;
  if (!reviewed && !force) {
    const ta = document.querySelector(`textarea[data-note="${cid}/boss"]`);
    const note = ta ? ta.value : getNote(cid + '/boss');
    if (note && note.trim()) saveNote(cid + '/boss', note);
    if (!note || note.trim().length < 10) {
      showModal(`<h2>Главарь сдаётся только с черновиком!</h2>
        <p>Запиши в блокнот хотя бы пару строк плана поимки — шеф хочет видеть ход мысли.</p>
        <button class="gold" data-act="closeModal">Запишу</button>
        <button class="ghost" data-act="bossWinForce" data-arg="${cid}">Всё равно победил(а)!</button>`);
      return;
    }
  }
  const got = reviewed ? Math.round(c.boss.points / 3) : c.boss.points;
  p.bosses[cid] = { done: true, got };
  if (typeof c.boss.letter === 'number' && p.letters.indexOf(c.boss.letter) < 0) {
    p.letters.push(c.boss.letter);
  }
  saveStore();
  unlockAch('a_boss');
  addPoints(got, true);
  const letter = DATA.mystery.word[c.boss.letter];
  confetti();
  showModal(`<h2>Главарь повержен! 🏆</h2>
    <div class="big">${c.emoji}✨</div>
    <p>Дело №${c.num} закрыто. +${got} 🪙</p>
    <div style="background:#f7efd9;border:2px dashed var(--gold);border-radius:8px;padding:14px;margin:10px 0;">
      <p>Ты получаешь букву тайного слова:</p>
      <div style="font-size:2.2em;font-weight:bold;color:#241c08">«${letter}»</div>
      <p class="small" style="color:var(--ink-soft)">Загляни на страницу <a href="#mystery" onclick="closeModal()">🗝️ Тайны</a>, когда соберёшь ещё буквы.</p>
    </div>
    <button class="gold" onclick="closeModal()">Отлично!</button>`);
  renderCase(cid);
}

/* ---------- экзамен ---------- */
function renderExam() {
  const p = P();
  const ex = p.exam;
  if (!ex.started) {
    $('app').innerHTML = headerHtml('exam') + `
      <div class="paper">
        <h4>${DATA.exam.title} · ${DATA.exam.subtitle}</h4>
        <p>${DATA.exam.intro}</p>
        <button class="gold" data-act="examStart">Начать экзамен ⏱</button>
      </div>
      <p class="muted small">${DATA.exam.source}</p>
      ${footerHtml()}`;
    return;
  }
  if (ex.submitted) { renderExamResults(); return; }
  const left = examMinutesLeft();
  const qs = DATA.exam.problems.map((q, i) => `
    <div class="problem exam-q">
      <div class="problem-top"><span class="badge-num">ЗАДАЧА ${i + 1}</span></div>
      <p class="stmt">${q.statement}</p>
      <div class="answer-row">
        <input type="text" id="ex-${q.id}" placeholder="${q.answerNote || 'ответ'}" value="${esc(ex.answers[q.id] || '')}" autocomplete="off">
        <button class="small-btn" data-act="examSave" data-arg="${q.id}">Занести в протокол</button>
        <span class="points-note" id="exok-${q.id}"></span>
      </div>
    </div>`).join('');
  $('app').innerHTML = headerHtml('exam') + `
    <div class="case-head"><h2>${DATA.exam.title}</h2><span class="exam-timer" id="exam-timer">⏱ --:--</span></div>
    <p class="muted small">Ответы заносятся в протокол по ходу. Жми «Сдать работу», когда закончишь — или когда время выйдет.</p>
    ${qs}
    <button class="primary" data-act="examSubmit">Сдать работу 📤</button>
    ${footerHtml()}`;
  updateExamTimer();
  examTimer = setInterval(updateExamTimer, 1000);
}
function examMinutesLeft() {
  const p = P();
  const end = p.exam.started + DATA.exam.timeMin * 60000;
  return Math.max(0, Math.ceil((end - Date.now()) / 60000));
}
function updateExamTimer() {
  const el = $('exam-timer');
  if (!el) { if (examTimer) clearInterval(examTimer); return; }
  const left = examMinutesLeft();
  el.textContent = '⏱ ' + (left >= 60 ? Math.floor(left / 60) + ' ч ' : '') + (left % 60) + ' мин';
  el.className = 'exam-timer' + (left <= 10 ? ' low' : '');
  if (left <= 0) examSubmit();
}
function examStart() {
  const p = P();
  p.exam = { best: p.exam.best, started: Date.now(), answers: {}, submitted: false };
  saveStore();
  renderExam();
}
function examSave(qid) {
  const p = P();
  p.exam.answers[qid] = $('ex-' + qid).value;
  saveStore();
  $('exok-' + qid).textContent = '✓ записано';
  setTimeout(() => { const el = $('exok-' + qid); if (el) el.textContent = ''; }, 1500);
}
function examSubmit() {
  const p = P();
  if (p.exam.submitted) return;
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
  // дозаписываем всё из полей
  DATA.exam.problems.forEach(q => { const el = $('ex-' + q.id); if (el) p.exam.answers[q.id] = el.value; });
  let score = 0;
  DATA.exam.problems.forEach(q => {
    const v = p.exam.answers[q.id] || '';
    if (q.answers.some(a => normHard(a) === normHard(v)) || q.answers.some(a => norm(a) === norm(v))) score++;
  });
  p.exam.submitted = true;
  p.exam.score = score;
  if (p.exam.best === null || score > p.exam.best) p.exam.best = score;
  if (score >= 5 && p.letters.indexOf(2) < 0) p.letters.push(2);
  saveStore();
  addPoints(score * DATA.exam.pointsPerTask, true);
  if (score >= 5) unlockAch('a_exam');
  renderExamResults();
}
function renderExamResults() {
  const p = P();
  const ex = p.exam;
  const rows = DATA.exam.problems.map((q, i) => {
    const v = ex.answers[q.id] || '';
    const ok = q.answers.some(a => normHard(a) === normHard(v)) || q.answers.some(a => norm(a) === norm(v));
    return `<div class="problem ${ok ? 'solved' : 'reviewed'}">
      <div class="problem-top"><span class="badge-num">ЗАДАЧА ${i + 1}</span> ${ok ? '<span class="badge-ok">✔</span>' : '<span class="result-bad">✘</span>'}</div>
      <p class="stmt">${q.statement}</p>
      <p class="small">Твой ответ: <b>${esc(v || '—')}</b> ${ok ? '' : '· правильный: <b>' + esc(q.answers[0]) + '</b>'}</p>
      <div class="solution-item"><b>Разбор.</b> ${q.solution}</div>
    </div>`;
  }).join('');
  $('app').innerHTML = headerHtml('exam') + `
    <div class="paper" style="text-align:center">
      <h4>Протокол экзамена</h4>
      <p class="exam-result">Верно <b>${ex.score} из ${DATA.exam.problems.length}</b> · +${ex.score * DATA.exam.pointsPerTask} 🪙</p>
      <p>${ex.score >= 6 ? 'Блестяще, агент! Шеф аплодирует.' : ex.score >= 4 ? 'Достойно! Разбери нерешённое — и в следующий раз будет больше.' : 'Экзамен — это тренировка. Пройдись по разборам, они внизу.'}</p>
      ${ex.score >= 5 ? '<p>🗝️ Получена буква тайного слова! <a href="#mystery">К Тайне</a>.</p>' : ''}
      <button class="gold" data-act="examAgain">Пройти заново 🔄</button>
    </div>
    ${rows}
    ${footerHtml()}`;
}

/* ---------- тайна ---------- */
function renderMystery() {
  const p = P();
  const word = DATA.mystery.word;
  const letters = [...word].map((ch, i) =>
    `<div class="mletter ${p.letters.indexOf(i) >= 0 ? '' : 'unknown'}" ${p.letters.indexOf(i) >= 0 ? '' : 'title="ещё не получена"'}>${p.letters.indexOf(i) >= 0 ? ch : '?'}</div>`).join('');
  const sources = [
    { i: 0, txt: 'Победить главаря дела №1 «Подозрительные монеты»' },
    { i: 1, txt: 'Победить главаря дела №2 «Показания свидетелей»' },
    { i: 2, txt: 'Сдать экзамен агентства на 5 из 8 и выше' },
    { i: 3, txt: 'Победить зверя-оборотня в деле №3 «Чётное — нечётное»' },
    { i: 4, txt: 'Победить главаря выставки в деле №4 «Двойная бухгалтерия»' },
    { i: 5, txt: 'Победить главаря-хамелеона в деле №5 «Ночь в музее»' }
  ].map(s => `<li ${p.letters.indexOf(s.i) >= 0 ? 'style="color:#7fae5f"' : 'class="muted"'}>${p.letters.indexOf(s.i) >= 0 ? '✓' : '○'} ${s.txt}</li>`).join('');
  let finale = '';
  if (p.mysterySolved) {
    finale = `<div class="paper" style="text-align:center;border:2px solid var(--gold)">
      <h4>ТАЙНА РАСКРЫТА 🗝️✨</h4>
      <p style="font-size:1.3em"><b>${word}</b></p>
      <p>${DATA.mystery.prizeNote}</p>
    </div>`;
  } else {
    finale = `<div class="paper">
      <h4>Знаешь слово целиком?</h4>
      <p class="note">${DATA.mystery.hint}</p>
      <div class="answer-row">
        <input type="text" id="mystery-word" placeholder="тайное слово" style="text-transform:uppercase">
        <button class="gold" data-act="mysteryTry">Попробовать</button>
      </div>
      <div id="mystery-res"></div>
    </div>`;
  }
  $('app').innerHTML = headerHtml('mystery') + `
    <div class="case-head"><h2>🗝️ Тайна агентства</h2></div>
    <p class="mystery-note">${DATA.mystery.prompt}</p>
    <div class="mystery-letters">${letters}</div>
    <div class="paper"><h4>Где добывают буквы</h4><ul>${sources}</ul></div>
    ${finale}
    ${footerHtml()}`;
}
function mysteryTry() {
  const p = P();
  const v = normHard($('mystery-word').value);
  if (v === normHard(DATA.mystery.word)) {
    p.mysterySolved = true;
    saveStore();
    unlockAch('a_mystery');
    confetti();
    renderMystery();
    showModal(`<h2>Тайна агентства раскрыта! 🗝️</h2><div class="big">✨🕵️✨</div>
      <p>${DATA.mystery.prizeNote}</p>
      <button class="gold" onclick="closeModal()">Гордиться собой</button>`);
  } else {
    $('mystery-res').innerHTML = '<span class="result-bad">Не то слово. Собери больше букв или подумай ещё!</span>';
  }
}

/* ---------- награды ---------- */
function renderAch() {
  const p = P();
  const cards = DATA.achievements.map(a => {
    const has = p.achievements.indexOf(a.id) >= 0;
    return `<div class="ach-card ${has ? '' : 'locked'}">
      <div class="em">${a.emoji}</div>
      <div><b>${a.title}</b><span class="small">${a.desc}</span></div>
    </div>`;
  }).join('');
  const t = titleFor(p.points);
  $('app').innerHTML = headerHtml('ach') + `
    <div class="case-head"><h2>🏅 Награды детектива</h2></div>
    <div class="paper"><h4>Звание</h4><p>Сейчас: <b>${t}</b> (${p.points} 🪙).</p>
    <p class="small muted">${DATA.titles.map(x => x.min + ' — ' + x.name).join(' · ')}</p></div>
    <div class="ach-grid">${cards}</div>
    ${footerHtml()}`;
}

/* ---------- профиль ---------- */
function renderProfilePage() {
  const p = P();
  const others = Object.keys(store.profiles).filter(id => id !== store.currentId)
    .map(id => `<button data-act="pickProfile" data-arg="${id}">${store.profiles[id].emoji} ${esc(store.profiles[id].name)}</button>`).join(' ');
  $('app').innerHTML = headerHtml('profile') + `
    <div class="case-head"><h2>👤 Профиль</h2></div>
    <div class="paper">
      <h4>Агент ${esc(p.name)} ${p.emoji}</h4>
      <p>Звание: <b>${titleFor(p.points)}</b> · Монеты: <b>${p.points} 🪙</b> · Наград: ${p.achievements.length}/${DATA.achievements.length} · Сейфов вскрыто: ${p.safesOpened.length}/${DATA.safes.length}</p>
      <p class="small muted">В агентстве с ${p.created}.</p>
      <div class="answer-row">
        <button data-act="goto" data-arg="#map">На карту</button>
        ${others ? `<span class="small muted">Сменить агента:</span> ${others}` : ''}
        <button class="ghost" data-act="saveProgress">💾 Сохранить прогресс в файл</button>
        <button class="ghost" data-act="resetProgress">🗑 Начать заново</button>
      </div>
    </div>
    <div class="paper">
      <h4>Оформление агентства</h4>
      <p class="small">Выбери, как выглядит штаб-квартира. Менять можно в любой момент.</p>
      <div class="theme-grid">
        ${THEMES.map(t => `
        <button class="theme-card ${store.ui.theme === t.id ? 'sel' : ''}" data-act="setTheme" data-arg="${t.id}">
          <div class="swatch">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div>
          <div class="t-label"><b>${t.name}</b><br><span class="small muted">${t.desc}</span></div>
        </button>`).join('')}
      </div>
    </div>
    <div class="paper">
      <h4>Перенос прогресса</h4>
      <p class="small">Прогресс живёт в этом браузере. Чтобы перенести его на другой ноут — сохрани в файл, а там загрузи (страница «Родителям» → «Загрузить сохранение»).</p>
    </div>
    ${footerHtml()}`;
}
function saveProgress() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agentstvo-logika-' + (P() ? P().name : 'save') + '-' + today() + '.json';
  a.click();
  toast('Файл сохранён — смотри в загрузки 💾');
}

/* ---------- родительская страница ---------- */
function adminNotesHtml() {
  const p = P();
  if (!p) return '<p class="small">Профиль не выбран.</p>';
  const rows = [];
  DATA.caseList.forEach(c => {
    c.problems.forEach((pr, i) => {
      if (pr.type !== 'open') return;
      const note = getNote(c.id + '/' + pr.id);
      if (!note || !note.trim()) return;
      const e = getEntry(c.id, pr.id);
      const st = e ? (e.status === 'solved' ? '✔ решена' : '▪ разобрана') : '— не закрыта';
      rows.push(`<div class="prize-row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <b>Дело №${c.num}, улика ${i + 1}</b> <span class="small" style="color:#8d8268">(${st})</span>
          <div class="small" style="color:#8d8268">${esc(pr.statement.slice(0, 90))}…</div>
          <div style="white-space:pre-wrap;margin-top:4px;background:rgba(0,0,0,.2);border-radius:6px;padding:8px 10px;">${esc(note)}</div>
        </div>
      </div>`);
    });
    const bossNote = getNote(c.id + '/boss');
    if (bossNote && bossNote.trim()) {
      const done = p.bosses[c.id] && p.bosses[c.id].done;
      rows.push(`<div class="prize-row" style="align-items:flex-start">
        <div style="flex:1;min-width:0">
          <b>Дело №${c.num}, ГЛАВАРЬ</b> <span class="small" style="color:#8d8268">(${done ? '✔ повержен' : '— ещё не побеждён'})</span>
          <div style="white-space:pre-wrap;margin-top:4px;background:rgba(0,0,0,.2);border-radius:6px;padding:8px 10px;">${esc(bossNote)}</div>
        </div>
      </div>`);
    }
  });
  return rows.length ? rows.join('') : '<p class="small">Пока ни одной записи: агент ещё не писал(а) ход мысли в блокноты задач.</p>';
}
function renderAdmin() {
  const pin = store.admin.pin;
  if (pin === null) {
    $('app').innerHTML = `
      <div class="topbar"><span class="brand"><span class="em">🔑</span> Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
      <div class="admin-box">
        <h3>Установка PIN</h3>
        <p class="small">Придумайте 4-значный PIN — он защитит эту страницу от любопытных агентов.</p>
        <div class="answer-row"><input type="password" id="pin1" maxlength="4" placeholder="PIN"> <input type="password" id="pin2" maxlength="4" placeholder="ещё раз"> <button class="gold" data-act="pinSet">Сохранить</button></div>
        <div id="pin-res"></div>
      </div>`;
    return;
  }
  if (!store.adminAuthed) {
    $('app').innerHTML = `
      <div class="topbar"><span class="brand"><span class="em">🔑</span> Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
      <div class="admin-box"><h3>Введите PIN</h3>
      <div class="answer-row"><input type="password" id="pin" maxlength="4" placeholder="PIN"> <button class="gold" data-act="pinCheck">Войти</button></div><div id="pin-res"></div></div>`;
    return;
  }
  const prizeRows = DATA.safes.map((thr, i) => {
    const pr = store.admin.prizes[i] || {};
    return `<div class="prize-row">
      <span class="thr">Сейф №${i + 1}<br><small>${thr} 🪙</small></span>
      <input type="text" data-prize="${i}" value="${esc(pr.text || '')}" placeholder="Например: поход в кино / 300 ₽ / выбор десерта">
      <input type="text" data-prizeimg="${i}" value="${esc(pr.img || '')}" placeholder="ссылка на картинку (необязательно)">
    </div>`;
  }).join('');
  $('app').innerHTML = `
    <div class="topbar"><span class="brand"><span class="em">🔑</span> Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
    <div class="admin-box">
      <h3>Призы в сейфах</h3>
      <p class="small">Сейф открывается сам, когда агент набирает указанные монеты. Впишите, что лежит в каждом (текст хранится только в этом браузере и не попадает в интернет). Пустое поле = нейтральная надпись «получи у родителей».</p>
      ${prizeRows}
      <div class="answer-row"><button class="gold" data-act="prizesSave">Сохранить призы</button><span id="prizes-res"></span></div>
    </div>
    <div class="admin-box">
      <h3>Записи агента</h3>
      ${adminNotesHtml()}
    </div>
    <div class="admin-box">
      <h3>Полезно знать</h3>
      <ul class="small">
        <li>Тайное слово агентства: <b>${DATA.mystery.word}</b> — не подсказывайте, но если угадает, сдержите главный приз 🙂</li>
        <li>Подсказки не наказание: с одной наводкой задача даёт ⅔ монет, с двумя — треть. Разбор = 0, но дело двигается.</li>
        <li>Звание растёт: ${DATA.titles.map(t => t.name + ' (' + t.min + '🪙)').join(' → ')}.</li>
      </ul>
    </div>
    <div class="admin-box">
      <h3>Обслуживание</h3>
      <div class="answer-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <button data-act="saveProgress">💾 Сохранить всё в файл (прогресс + призы)</button>
        <label class="small">📥 Загрузить сохранение: <input type="file" id="restore-file" accept=".json"></label>
        <button class="ghost" data-act="pinReset">Сбросить PIN</button>
      </div>
      <div id="admin-res"></div>
    </div>
    <footer class="site-foot">${DATA.credits}</footer>`;
}

/* ---------- модальные окна, тосты, конфетти ---------- */
function showModal(html) {
  $('modal-root').innerHTML = `<div class="modal">${html}</div>`;
  $('modal-root').classList.add('show');
}
function closeModal() {
  $('modal-root').classList.remove('show');
  $('modal-root').innerHTML = '';
  if (safeModalQueue.length) showNextSafe();
}
function toast(text, cls) {
  const t = document.createElement('div');
  t.className = 'toast ' + (cls || '');
  t.textContent = text;
  $('toast-wrap').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const parts = ['🪙', '✨', '🎉', '📜', '🗝️', '⭐'];
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span');
    s.textContent = parts[Math.floor(Math.random() * parts.length)];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
    s.style.animationDelay = (Math.random() * 0.6) + 's';
    s.style.fontSize = (14 + Math.random() * 14) + 'px';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

/* ---------- обработчик кликов ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, arg = el.dataset.arg;
  switch (act) {
    case 'goto': location.hash = arg.slice(1); break;
    case 'briefGo':
    case 'briefSkip': {
      const p = P();
      if (p) { p.briefed = true; saveStore(); }
      location.hash = '';
      route();
      toast('Добро пожаловать в агентство, ' + (p ? p.name : 'агент') + '!');
      break;
    }
    case 'pickProfile': store.currentId = arg; store.adminAuthed = false; saveStore(); location.hash = ''; route(); break;
    case 'pickEmoji': {
      const box = $('np-emoji');
      box.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
      el.classList.add('sel');
      box.dataset.sel = el.dataset.arg;
      break;
    }
    case 'createProfile': {
      const name = $('np-name').value.trim();
      if (!name) { $('np-name').focus(); return; }
      const av = ['🕵️‍♀️', '🕵️', '🦉', '🐈‍⬛', '🦊', '🐺', '🧐', '👩‍✈️', '🐢', '🦅'][$('np-emoji').dataset.sel || 0];
      newProfile(name, av);
      location.hash = '';
      route();
      toast('Добро пожаловать в агентство, ' + name + '!');
      break;
    }
    case 'earlyUnlock': {
      const cid = arg;
      showModal(`<h2>Открыть дело досрочно?</h2><p>Шеф рекомендует порядок, но не запрещает смелость. Открыть?</p>
        <button class="gold" data-act="confirmEarly" data-arg="${cid}">Открываю!</button>
        <button data-act="closeModal">Лучше по порядку</button>`);
      break;
    }
    case 'confirmEarly': P().earlyUnlock[arg] = true; saveStore(); closeModal(); route(); break;
    case 'hint': { const [cid, pid, lvl] = arg.split('|'); hintPressed(cid, pid, +lvl); break; }
    case 'viewSolution': { const [cid, pid] = arg.split('|'); solutionPressed(cid, pid); break; }
    case 'confirmSolution': { const [cid, pid] = arg.split('|'); confirmSolution(cid, pid); break; }
    case 'closeModal': closeModal(); break;
    case 'checkAnswer': { const [cid, pid] = arg.split('|'); checkAnswer(cid, pid); break; }
    case 'selfSolved': { const [cid, pid] = arg.split('|'); selfSolved(cid, pid, false); break; }
    case 'selfSolvedForce': { const [cid, pid] = arg.split('|'); selfSolved(cid, pid, true); break; }
    case 'bossHint': { const [cid, lvl] = arg.split('|'); bossHintPressed(cid, +lvl); break; }
    case 'bossSolution': bossSolutionPressed(arg); break;
    case 'bossWin': bossWin(arg, false, false); break;
    case 'bossWinForce': bossWin(arg, false, true); break;
    case 'bossReview': bossWin(arg, true); break;
    case 'examStart': examStart(); break;
    case 'examSave': examSave(arg); break;
    case 'examSubmit':
      showModal(`<h2>Сдать работу?</h2><p>Проверить протокол и показать разборы? Вернуться к задачам уже не получится.</p>
        <button class="gold" data-act="confirmExamSubmit">Сдаю 📤</button> <button data-act="closeModal">Ещё думаю</button>`);
      break;
    case 'confirmExamSubmit': closeModal(); examSubmit(); break;
    case 'examAgain': examStart(); break;
    case 'mysteryTry': mysteryTry(); break;
    case 'saveProgress': saveProgress(); break;
    case 'setTheme': {
      store.ui = store.ui || {};
      store.ui.theme = arg;
      saveStore();
      applyTheme();
      route();
      toast('Оформление: ' + (THEMES.find(t => t.id === arg) || {}).name);
      break;
    }
    case 'resetProgress':
      showModal(`<h2>Начать заново?</h2>
        <p>Весь прогресс агента <b>${esc(P().name)}</b> — баллы, закрытые задачи, награды, сейфы, буквы — обнулится. Имя останется. Отменить будет нельзя.</p>
        <button class="primary" data-act="confirmReset">Да, обнулить</button>
        <button data-act="closeModal">Отмена</button>`);
      break;
    case 'confirmReset': {
      const old = P();
      store.profiles[store.currentId] = {
        name: old.name, emoji: old.emoji, created: today(),
        points: 0, problems: {}, notes: {}, bosses: {}, earlyUnlock: {},
        letters: [], mysterySolved: false, achievements: [],
        activity: [], views: {},
        exam: { best: null, started: null, answers: {}, submitted: false },
        safesOpened: []
      };
      saveStore();
      closeModal();
      location.hash = '';
      route();
      toast('Чистый лист, агент!');
      break;
    }
    case 'showSafe': { const pr = safePrize(+arg); showModal(`<h2>Сейф №${+arg + 1}</h2><div class="big">${'🗄️'}</div><p><b>${esc(pr.text)}</b></p>${pr.img ? `<img src="${esc(pr.img)}" style="max-width:100%;border-radius:8px;">` : ''}<button class="gold" onclick="closeModal()">Закрыть</button>`); break; }
    case 'pinSet': {
      const a = $('pin1').value, b = $('pin2').value;
      if (!/^\d{4}$/.test(a) || a !== b) { $('pin-res').innerHTML = '<span class="result-bad">PIN — 4 одинаковые цифры в обоих полях.</span>'; return; }
      store.admin.pin = btoa(a); store.adminAuthed = true; saveStore(); renderAdmin();
      break;
    }
    case 'pinCheck': {
      if (btoa($('pin').value) === store.admin.pin) { store.adminAuthed = true; saveStore(); renderAdmin(); }
      else $('pin-res').innerHTML = '<span class="result-bad">Неверный PIN.</span>';
      break;
    }
    case 'pinReset': store.admin.pin = null; store.adminAuthed = false; saveStore(); renderAdmin(); break;
    case 'prizesSave': {
      document.querySelectorAll('[data-prize]').forEach(inp => {
        const i = inp.dataset.prize;
        store.admin.prizes[i] = store.admin.prizes[i] || {};
        store.admin.prizes[i].text = inp.value.trim();
      });
      document.querySelectorAll('[data-prizeimg]').forEach(inp => {
        const i = inp.dataset.prizeimg;
        store.admin.prizes[i] = store.admin.prizes[i] || {};
        store.admin.prizes[i].img = inp.value.trim();
      });
      saveStore();
      $('prizes-res').innerHTML = '<span class="result-ok">Сохранено ✓</span>';
      break;
    }
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'restore-file') {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (!obj.profiles) throw new Error('bad');
        store = obj;
        saveStore();
        $('admin-res').innerHTML = '<span class="result-ok">Сохранение загружено ✓</span>';
        toast('Прогресс восстановлен');
        route();
      } catch (e) { $('admin-res').innerHTML = '<span class="result-bad">Файл не похож на сохранение агентства.</span>'; }
    };
    r.readAsText(f);
  }
});
document.addEventListener('input', (ev) => {
  const ta = ev.target;
  if (ta && ta.dataset && ta.dataset.note) saveNote(ta.dataset.note, ta.value);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    const el = ev.target;
    if (el && el.id && el.id.startsWith('ans-')) {
      const pid = el.id.slice(4);
      const btn = document.querySelector(`[data-act="checkAnswer"][data-arg$="|${pid}"]`);
      if (btn) btn.click();
    }
    if (el && el.id === 'mystery-word') mysteryTry();
  }
  if (ev.key === 'Escape') closeModal();
});

/* ---------- старт ---------- */
applyTheme();
route();
