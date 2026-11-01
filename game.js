// ============================================================
// game.js —— 遊戲的「規則」與「畫面」
//
// 這個檔案分成六個部分：
//   1. 遊戲狀態   ：記住玩家目前玩到哪
//   2. 存檔／讀檔 ：關掉網頁再打開，進度還在
//   3. 小工具     ：幾個常用的小函式
//   4. 畫面       ：把狀態變成畫面（render 開頭的函式）
//   5. 動作       ：玩家按按鈕後會發生什麼事
//   6. 啟動       ：載入存檔、畫出第一個畫面
//
// 初學者不用一次看懂，先從 level1.js 改內容開始就好。
// ============================================================


// ---------- 1. 遊戲狀態 ----------
// 所有畫面都是根據這個 state 畫出來的。只要改 state，再呼叫 render()，畫面就會更新。
const SAVE_KEY = "stream-detective-" + LEVEL.id;

// 因果鏈有幾個空格，由 level1.js 的 chain 決定
const SLOT_COUNT = LEVEL.chain.length;

function emptySlots() {
  return new Array(SLOT_COUNT).fill(null);
}

function newState() {
  return {
    phase: "intro",              // 目前階段：intro 開場 / play 調查中 / repair 選修復 / failed 推理失敗 / done 通關
    tab: "investigate",          // 目前分頁：investigate 調查 / codex 圖鑑 / board 證據板
    location: LEVEL.locations[0].id, // 目前所在地點
    clues: [],                   // 已蒐集的線索 id
    species: [],                 // 已解鎖的圖鑑 id
    slots: emptySlots(),         // 因果鏈的空格，例如 ["sewage", null, null]（null 代表還沒填）
    activeSlot: null,            // 目前選到、準備要填的空格編號（沒選就是 null）
    feedback: null,              // 提醒訊息（例如線索不夠、空格沒填完）
    repairFeedback: null,        // 選修復行動後的回饋訊息
    attempts: 1,                 // 目前是第幾次挑戰
    failChain: [],               // 推理失敗時，玩家提交的因果鏈
    failResults: [],             // 推理失敗時，每個空格的判定結果 {ok, hint}
    dialog: null                 // 目前開著的確認視窗："submit" 或 "restart"，沒有就是 null
  };
}

let state = newState();


// ---------- 2. 存檔／讀檔 ----------
// localStorage 是瀏覽器內建的小倉庫，不需要伺服器
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    // 存檔失敗（例如瀏覽器禁用）就算了，不影響遊戲進行
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) state = Object.assign(newState(), JSON.parse(raw));
  } catch (e) {
    state = newState();
  }

  // 檢查存檔內容是否合理（舊版存檔或被改壞的存檔，不要讓遊戲當掉）
  const validIds = LEVEL.nodes.map(n => n.id);
  if (!Array.isArray(state.slots) || state.slots.length !== SLOT_COUNT) {
    state.slots = emptySlots();
  }
  state.slots = state.slots.map(id => (validIds.includes(id) ? id : null));
  if (!Array.isArray(state.failChain)) state.failChain = [];
  if (!Array.isArray(state.failResults)) state.failResults = [];
  state.activeSlot = null;
  state.dialog = null; // 重新整理後，不要停在確認視窗
}


// ---------- 3. 小工具 ----------
const app = document.getElementById("app");

// 把所有地點的調查點合成一份清單
function allSpots() {
  return LEVEL.locations.flatMap(loc => loc.spots);
}

// 找出某個調查點屬於哪個地點
function locationOf(spotId) {
  return LEVEL.locations.find(loc => loc.spots.some(s => s.id === spotId));
}

// 概念卡 id → 顯示文字（例如 "sewage" → "🚰 家庭汙水排入"）
function nodeLabel(id) {
  const n = LEVEL.nodes.find(n => n.id === id);
  return n ? n.emoji + " " + n.label : id;
}

// 把一串卡片 id 變成「A ➜ B ➜ C」
function chainText(ids) {
  return ids.map(nodeLabel).join(' <b class="sep">➜</b> ');
}

// 依挑戰次數取得通關評價
function ratingOf(attempts) {
  return LEVEL.ratings.find(r => attempts <= r.maxAttempts) || LEVEL.ratings[LEVEL.ratings.length - 1];
}

// 小提示（toast）
let toastTimer;
function showToast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// 推理判定：逐格比對玩家填的和標準答案
function checkReasoning(slots, chain) {
  const results = chain.map((answer, i) => {
    const got = slots[i];
    const ok = got === answer;
    const hint = ok ? "" : (LEVEL.wrongHints[i + ":" + got] || LEVEL.defaultWrongHint);
    return { ok: ok, hint: hint };
  });
  return { passed: results.every(r => r.ok), results: results };
}


// ---------- 4. 畫面 ----------
function feedbackHTML(fb) {
  if (!fb) return "";
  return `
    <div class="feedback ${fb.type}">
      <strong>${fb.title}</strong>
      <ul>${fb.lines.map(t => `<li>${t}</li>`).join("")}</ul>
    </div>`;
}

function renderIntro() {
  return `
    <section class="panel hero">
      <h1>🔎 ${LEVEL.title}</h1>
      <p class="lead">${LEVEL.brief}</p>
      <h3>怎麼玩</h3>
      <ol class="howto">
        <li><b>調查</b>：到不同地點，使用工具蒐集線索，也會發現新的生物。</li>
        <li><b>填空</b>：到「證據板」，把卡片填進空格，完成「${LEVEL.slotNames.join(" ➜ ")}」的因果鏈。</li>
        <li><b>提交</b>：有把握了就提交推理。<b>推理不成立就算失敗，必須重新調查</b>（線索與圖鑑會歸零），所以提交前要想清楚。</li>
      </ol>
      <p class="muted">提示：至少蒐集 ${LEVEL.minClues} 條線索才能提交推理。${LEVEL.note}</p>
      <button class="primary" data-action="start">開始調查</button>
    </section>`;
}

function renderInvestigate() {
  const loc = LEVEL.locations.find(l => l.id === state.location);

  const locTabs = LEVEL.locations.map(l => `
    <button class="loc ${l.id === state.location ? "active" : ""}" data-action="goto" data-id="${l.id}">
      ${l.emoji} ${l.name}
    </button>`).join("");

  const spots = loc.spots.map(spot => {
    if (state.clues.includes(spot.id)) {
      // 已經蒐集過：顯示線索內容
      return `
        <div class="spot got">
          <div class="spot-head">${spot.icon} ${spot.tool}</div>
          <p>${spot.clue}</p>
        </div>`;
    }
    // 還沒蒐集：顯示可以點的按鈕
    return `
      <button class="spot new" data-action="collect" data-id="${spot.id}">
        <div class="spot-head">${spot.icon} ${spot.tool}</div>
        <p>${spot.label}</p>
      </button>`;
  }).join("");

  return `
    <section class="panel">
      <div class="loc-tabs">${locTabs}</div>
      <p class="loc-intro">${loc.intro}</p>
      <div class="spots">${spots}</div>
    </section>`;
}

function renderCodex() {
  const cards = LEVEL.species.map(s => {
    if (state.species.includes(s.id)) {
      return `
        <div class="species">
          <div class="species-emoji">${s.emoji}</div>
          <h3>${s.name}</h3>
          <p class="tag">${s.role}</p>
          <p>${s.text}</p>
        </div>`;
    }
    return `
      <div class="species locked">
        <div class="species-emoji">❓</div>
        <h3>？？？</h3>
        <p>還沒發現。繼續調查，也許能找到它。</p>
      </div>`;
  }).join("");

  return `
    <section class="panel">
      <h2>📖 生態圖鑑</h2>
      <p class="muted">已發現 ${state.species.length} / ${LEVEL.species.length}</p>
      <div class="codex">${cards}</div>
    </section>`;
}

// 證據板上的一個空格（玩家可以點的）
function slotHTML(i) {
  const id = state.slots[i];
  const cls = ["slot"];
  if (id) cls.push("filled");
  if (state.activeSlot === i) cls.push("active");

  return `
    <button class="${cls.join(" ")}" data-action="slot" data-id="${i}">
      <span class="slot-name">${LEVEL.slotNames[i]}</span>
      <span class="slot-body">${id ? nodeLabel(id) : "＿＿＿＿"}</span>
      <span class="slot-hint">${id ? "點一下取出" : (state.activeSlot === i ? "請選一張卡片" : "空格")}</span>
    </button>`;
}

function renderBoard() {
  const slots = state.slots.map((_, i) => slotHTML(i)).join('<div class="arrow">➜</div>');

  const pool = LEVEL.nodes.map(n => `
    <button class="node" data-action="place" data-id="${n.id}" ${state.slots.includes(n.id) ? "disabled" : ""}>
      <span class="node-emoji">${n.emoji}</span>
      <span>${n.label}</span>
    </button>`).join("");

  const help = state.activeSlot !== null
    ? `已選「${LEVEL.slotNames[state.activeSlot]}」這一格，請點下面的一張卡片放進去。`
    : "點下面的卡片，會從左到右依序填進空格。想換掉某一格：先點那一格取出，再選新的卡片。";

  const notes = allSpots()
    .filter(s => state.clues.includes(s.id))
    .map(s => `<li>${s.icon} <b>${locationOf(s.id).name}</b>：${s.clue}</li>`)
    .join("") || `<li class="muted">還沒有線索，先到「調查」分頁蒐集吧。</li>`;

  return `
    <section class="panel">
      <h2>🧩 證據板</h2>
      <p class="muted">${help}</p>

      <h3>你的因果鏈</h3>
      <div class="slots">${slots}</div>

      <h3>可用的卡片</h3>
      <div class="nodes">${pool}</div>

      <div class="board-actions">
        <button class="primary" data-action="submit">提交推理</button>
        <button class="secondary" data-action="clearSlots">清空空格</button>
      </div>
      <p class="danger-note">⚠️ 提交後如果推理不成立，必須重新調查。</p>
      ${feedbackHTML(state.feedback)}

      <details class="notes" open>
        <summary>📝 線索筆記（${state.clues.length} 條）</summary>
        <ul>${notes}</ul>
      </details>
    </section>`;
}

function renderFailed() {
  // 玩家提交的因果鏈，每格標示對或錯
  const cards = state.failChain.map((id, i) => {
    const r = state.failResults[i] || { ok: false };
    return `
      <div class="slot filled ${r.ok ? "ok" : "bad"}">
        <span class="slot-name">${LEVEL.slotNames[i]}</span>
        <span class="slot-body">${nodeLabel(id)}</span>
        <span class="slot-mark">${r.ok ? "✓ 正確" : "✗ 不對"}</span>
      </div>`;
  }).join('<div class="arrow">➜</div>');

  // 只列出填錯的格子，並給提示
  const why = state.failResults.map((r, i) => r.ok ? "" : `
      <li><b>「${LEVEL.slotNames[i]}」</b>你填了「${nodeLabel(state.failChain[i])}」：${r.hint}</li>`).join("");

  return `
    <section class="panel">
      <h2 class="fail-title">❌ 推理失敗</h2>
      <p>你的因果鏈沒有通過，這次調查必須重新來過。先看看哪裡出了問題：</p>

      <h3>你提交的因果鏈</h3>
      <div class="slots">${cards}</div>

      <h3>問題出在哪裡</h3>
      <ul class="why">${why}</ul>

      <p class="muted">這是第 ${state.attempts} 次挑戰。重新調查時，線索與圖鑑都會歸零，請把剛才學到的帶進下一次。</p>
      <button class="primary" data-action="retry">🔄 重新調查</button>
    </section>`;
}

function renderRepair() {
  const wrongFb = state.repairFeedback && !state.repairFeedback.correct
    ? `<div class="feedback bad"><strong>再想想：</strong><ul><li>${state.repairFeedback.text}</li></ul></div>`
    : "";

  const options = LEVEL.repair.options.map(o =>
    `<button class="option" data-action="repair" data-id="${o.id}">${o.text}</button>`).join("");

  return `
    <section class="panel">
      <h2>✅ 推理成立！</h2>
      <p>你找出的因果鏈：</p>
      <p class="chain-line">${chainText(LEVEL.chain)}</p>
      <h3>${LEVEL.repair.question}</h3>
      <div class="options">${options}</div>
      ${wrongFb}
    </section>`;
}

function renderDone() {
  const goals = LEVEL.goals.map(g => `<li>${g}</li>`).join("");
  const fbText = state.repairFeedback ? state.repairFeedback.text : "";
  const rating = ratingOf(state.attempts);

  return `
    <section class="panel hero">
      <h1>🎉 結案：${LEVEL.title}</h1>
      <p class="stars">${"⭐".repeat(rating.stars)}</p>
      <p class="success">${rating.label}（第 ${state.attempts} 次挑戰）</p>
      <p>${fbText}</p>

      <h3>因果鏈</h3>
      <p class="chain-line">${chainText(LEVEL.chain)}</p>

      <h3>現實對照</h3>
      <p>${LEVEL.reflection}</p>

      <h3>你練習了</h3>
      <ul>${goals}</ul>

      <p class="muted">圖鑑：${state.species.length} / ${LEVEL.species.length}　線索：${state.clues.length} / ${allSpots().length}</p>
      <button class="primary" data-action="restart">再玩一次</button>
    </section>`;
}

// 確認視窗（浮在畫面上方）。用自己做的，不用瀏覽器內建的 confirm，這樣在各種環境都能正常運作。
function renderDialog() {
  if (!state.dialog) return "";
  const cfg = {
    submit: {
      title: "確定要提交推理嗎？",
      text: "提交後如果推理不成立，就必須重新調查，目前蒐集的線索與圖鑑會全部歸零。",
      yes: "確定提交",
      no: "再想想"
    },
    restart: {
      title: "確定要重新開始嗎？",
      text: "目前的進度會被清除。",
      yes: "重新開始",
      no: "取消"
    }
  }[state.dialog];

  return `
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${cfg.title}</h3>
        <p>${cfg.text}</p>
        <div class="dialog-actions">
          <button class="primary" data-action="dialogYes">${cfg.yes}</button>
          <button class="secondary" data-action="dialogNo">${cfg.no}</button>
        </div>
      </div>
    </div>`;
}

// 依照 state 決定要畫哪個畫面
function render() {
  document.getElementById("clue-count").textContent =
    "🔍 線索 " + state.clues.length + "/" + allSpots().length;
  document.getElementById("attempt").textContent =
    state.phase === "intro" ? "" : "第 " + state.attempts + " 次挑戰";

  // 分頁按鈕只在「調查中」顯示
  document.getElementById("tabs").hidden = state.phase !== "play";
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.id === state.tab);
  });

  let html;
  if (state.phase === "intro") {
    html = renderIntro();
  } else if (state.phase === "play") {
    if (state.tab === "board") html = renderBoard();
    else if (state.tab === "codex") html = renderCodex();
    else html = renderInvestigate();
  } else if (state.phase === "repair") {
    html = renderRepair();
  } else if (state.phase === "failed") {
    html = renderFailed();
  } else {
    html = renderDone();
  }
  app.innerHTML = html;
  document.getElementById("dialog").innerHTML = renderDialog();
}


// ---------- 5. 動作 ----------
// 每個按鈕上的 data-action 名稱，會對應到這裡的一個函式
const actions = {
  // 開始遊戲
  start() {
    state.phase = "play";
  },

  // 切換分頁（調查／圖鑑／證據板）
  tab(d) {
    state.tab = d.id;
  },

  // 切換地點
  goto(d) {
    state.location = d.id;
  },

  // 蒐集線索
  collect(d) {
    if (state.clues.includes(d.id)) return;
    state.clues.push(d.id);

    // 如果這條線索會解鎖圖鑑，就一起處理
    const spot = allSpots().find(s => s.id === d.id);
    if (spot && spot.species && !state.species.includes(spot.species)) {
      state.species.push(spot.species);
      const sp = LEVEL.species.find(s => s.id === spot.species);
      showToast("🎉 圖鑑新增：" + sp.name);
    }
  },

  // 證據板：點一個空格
  //   - 空格裡有卡片 → 把卡片取出來，並選取這一格（下一張卡片會填到這裡）
  //   - 空格是空的   → 選取這一格（再點一次取消選取）
  slot(d) {
    const i = Number(d.id);
    state.feedback = null;
    if (state.slots[i]) {
      state.slots[i] = null;
      state.activeSlot = i;
    } else {
      state.activeSlot = state.activeSlot === i ? null : i;
    }
  },

  // 證據板：點一張卡片，放進空格
  //   - 有選取的空格 → 放進那一格
  //   - 沒有選取     → 放進最左邊的空格
  place(d) {
    state.feedback = null;
    if (state.slots.includes(d.id)) return;      // 這張已經放在某一格了

    let target = state.activeSlot;
    if (target === null) target = state.slots.indexOf(null);

    if (target === -1) {                          // 空格都滿了
      state.feedback = {
        type: "warn",
        title: "空格都滿了",
        lines: ["點一個空格可以把卡片取出來，再放入新的卡片。"]
      };
      return;
    }
    state.slots[target] = d.id;
    state.activeSlot = null;
  },

  // 清空所有空格
  clearSlots() {
    state.slots = emptySlots();
    state.activeSlot = null;
    state.feedback = null;
  },

  // 按下「提交推理」：先檢查條件夠不夠，夠了就跳出確認視窗
  submit() {
    if (state.clues.length < LEVEL.minClues) {
      state.feedback = {
        type: "warn",
        title: "再多調查一些吧！",
        lines: ["至少要蒐集 " + LEVEL.minClues + " 條線索才能提交，目前只有 " + state.clues.length + " 條。"]
      };
      return;
    }
    const emptyCount = state.slots.filter(id => id === null).length;
    if (emptyCount > 0) {
      state.feedback = {
        type: "warn",
        title: "還沒填完",
        lines: ["因果鏈還有 " + emptyCount + " 個空格沒有填，請把每一格都填好再提交。"]
      };
      return;
    }
    state.feedback = null;
    state.dialog = "submit";
  },

  // 確認視窗：按「是」
  dialogYes() {
    const which = state.dialog;
    state.dialog = null;

    if (which === "restart") {
      state = newState();                   // 全部重來（挑戰次數也歸 1）
      return;
    }

    if (which === "submit") {
      const result = checkReasoning(state.slots, LEVEL.chain);
      if (result.passed) {
        state.phase = "repair";             // 推理成立 → 進入選修復行動
      } else {
        state.phase = "failed";             // 推理失敗 → 進入失敗畫面
        state.failChain = state.slots.slice();
        state.failResults = result.results;
      }
    }
  },

  // 確認視窗：按「否」
  dialogNo() {
    state.dialog = null;
  },

  // 推理失敗後「重新調查」：線索、圖鑑、空格全部歸零，挑戰次數 +1
  retry() {
    const nextAttempt = state.attempts + 1;
    state = newState();
    state.attempts = nextAttempt;
    state.phase = "play";
  },

  // 選擇修復行動
  repair(d) {
    const opt = LEVEL.repair.options.find(o => o.id === d.id);
    state.repairFeedback = { correct: opt.correct, text: opt.feedback };
    if (opt.correct) state.phase = "done";
  },

  // 按下「重新開始」：先跳出確認視窗
  restart() {
    state.dialog = "restart";
  }
};

// 整個網頁只聽一個「點擊」事件：
// 點到有 data-action 的按鈕 → 執行對應動作 → 存檔 → 重新畫畫面
document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  fn(el.dataset);
  saveGame();
  render();
});


// ---------- 6. 啟動 ----------
loadGame();
render();
