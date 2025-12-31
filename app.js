/* JHSE Vocab - GitHub Pages Single Page App
 * - words.json: [{ en, ja, level(1-3), series, forms?: {base,past,pp} }]
 * - Quiz types:
 *   1) mc (4択10問) : direction en->ja / ja->en
 *   2) typing (打ち込み10問) : direction en->ja / ja->en
 *   3) mix (形5 + 系5 =10問)
 *      - 形問題: 動詞の forms を使い、提示された形が「現在/過去/過去分詞」のどれか（4択）
 *        ※ 形が同一（cut/cut/cut 等）の場合、該当する複数の答えを全て正解扱い
 *      - 系問題: 「【series】 ja は英語で？」（打ち込み） 5問
 */

const $ = (id) => document.getElementById(id);

const els = {
  setup: $("setup"),
  quiz: $("quiz"),
  result: $("result"),

  userName: $("userName"),
  saveUserBtn: $("saveUserBtn"),

  level: $("level"),
  quizType: $("quizType"),
  direction: $("direction"),
  directionHint: $("directionHint"),

  startBtn: $("startBtn"),
  startBtn2: $("startBtn2"),
  backBtn: $("backBtn"),
  backBtn2: $("backBtn2"),
  reviewBtn: $("reviewBtn"),
  resetBtn: $("resetBtn"),

  rankChip: $("rankChip"),
  rankName: $("rankName"),
  rankRemain: $("rankRemain"),
  barFill: $("barFill"),

  totalOk: $("totalOk"),
  totalAns: $("totalAns"),
  acc: $("acc"),
  missCnt: $("missCnt"),

  qTypePill: $("qTypePill"),
  progress: $("progress"),
  qText: $("qText"),
  choices: $("choices"),
  typing: $("typing"),
  typeInput: $("typeInput"),
  checkBtn: $("checkBtn"),
  typeMeaning: $("typeMeaning"),
  typeExample: $("typeExample"),
  feedback: $("feedback"),
  nextBtn: $("nextBtn"),
  quitBtn: $("quitBtn"),

  resultText: $("resultText"),
  missList: $("missList"),
  retryMissBtn: $("retryMissBtn"),
};

const STORAGE_KEY = "jhse_vocab_v3";

// ---- Rank rules (緩和 + 正答率で昇降格) ----
const RANKS = [
  { key: "beginner",  name: "ビギナー",     needOk: 0,    css: "rank-beginner" },
  { key: "iron",      name: "アイロン",     needOk: 30,   css: "rank-iron" },
  { key: "bronze",    name: "ブロンズ",     needOk: 90,   css: "rank-bronze" },
  { key: "silver",    name: "シルバー",     needOk: 180,  css: "rank-silver" },
  { key: "gold",      name: "ゴールド",     needOk: 320,  css: "rank-gold" },
  { key: "platinum",  name: "プラチナ",     needOk: 520,  css: "rank-platinum" },
  { key: "diamond",   name: "ダイヤモンド", needOk: 780,  css: "rank-diamond" },
  { key: "master",    name: "マスター",     needOk: 1100, css: "rank-master" }
];

// 正答率（直近50問）に応じてランクを±1調整
function accuracyDelta(acc01){
  if (acc01 >= 0.88) return +1;
  if (acc01 <= 0.60) return -1;
  return 0;
}

// ---- State ----
let WORDS = [];
let state = null;

function defaultState(){
  return {
    userName: "",
    totalAns: 0,
    totalOk: 0,
    // recent: 直近の正誤（最大50）
    recent: [],
    // miss: { "en||ja": {en,ja,level,series,forms?, misses:number} }
    miss: {},
    // lastConfig: setup画面の前回選択
    lastConfig: { level: 1, quizType: "mc", direction: "en_to_ja" },
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, lastConfig: { ...d.lastConfig, ...(s.lastConfig||{}) } };
  }catch{
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function screen(name){
  for(const k of ["setup","quiz","result"]){
    els[k].classList.toggle("hidden", k !== name);
  }
}

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function keyOfWord(w){ return `${w.en}||${w.ja}`; }

function norm(s){
  return String(s||"")
    .trim()
    .replace(/\s+/g," ")
    .toLowerCase();
}

// ---- Rank UI ----
function computeRecentAcc(){
  const r = state.recent || [];
  if(r.length === 0) return 0;
  const ok = r.reduce((a,b)=>a+(b?1:0),0);
  return ok / r.length;
}

function baseRankIndexByOk(totalOk){
  let idx = 0;
  for(let i=0;i<RANKS.length;i++){
    if(totalOk >= RANKS[i].needOk) idx = i;
  }
  return idx;
}

function effectiveRankIndex(){
  const base = baseRankIndexByOk(state.totalOk);
  const acc = computeRecentAcc();
  const delta = accuracyDelta(acc);
  return clamp(base + delta, 0, RANKS.length-1);
}

function updateRankUI(){
  const eff = effectiveRankIndex();
  const base = baseRankIndexByOk(state.totalOk);
  const acc = computeRecentAcc();

  const r = RANKS[eff];
  els.rankName.textContent = r.name;

  // 次まで（累計正解）: effectiveではなく base に基づく次閾値を表示
  const next = RANKS[Math.min(base+1, RANKS.length-1)];
  const remain = Math.max(0, next.needOk - state.totalOk);
  els.rankRemain.textContent = (base === RANKS.length-1) ? "MAX" : `${remain}`;

  // Progress bar: baseランクの区間に対する進捗
  const curNeed = RANKS[base].needOk;
  const nextNeed = next.needOk;
  const pct = (base === RANKS.length-1) ? 100 :
    ( (state.totalOk - curNeed) / Math.max(1,(nextNeed - curNeed)) ) * 100;
  els.barFill.style.width = `${clamp(pct,0,100)}%`;

  // Chip style
  els.rankChip.className = `rankChip ${r.css}`;
  els.rankChip.textContent = r.name;

  // Stats
  els.totalAns.textContent = String(state.totalAns);
  els.totalOk.textContent = String(state.totalOk);
  els.acc.textContent = `${Math.round(acc*100)}%`;
  els.missCnt.textContent = String(Object.keys(state.miss||{}).length);
}

// ---- words.json ----
async function loadWords(){
  const res = await fetch("./words.json", { cache: "no-store" });
  if(!res.ok) throw new Error("words.json を読み込めませんでした");
  const data = await res.json();

  // allow either flat list or legacy {levels:[{level,words:[]}]}
  let list = [];
  if(Array.isArray(data)){
    list = data;
  }else if(data && Array.isArray(data.levels)){
    for(const lv of data.levels){
      for(const w of (lv.words||[])){
        list.push({
          en: w.en,
          ja: w.ja,
          level: lv.level ?? w.level ?? 1,
          series: w.series || "その他",
          ...(w.forms ? { forms: w.forms } : {}),
        });
      }
    }
  }else{
    throw new Error("words.json の形式が不正です");
  }

  // sanitize
  list = list
    .filter(w=>w && w.en && w.ja)
    .map(w=>({
      en: String(w.en),
      ja: String(w.ja),
      level: Number(w.level)||1,
      series: String(w.series||"その他"),
      ...(w.forms ? { forms: w.forms } : {}),
    }));

  // ensure 1..3
  list.forEach(w=>{ w.level = clamp(w.level,1,3); });

  return list;
}

// ---- Question generator ----
function pickWordsByLevel(level){
  return WORDS.filter(w=>w.level === level);
}

function buildQuestionPool(config, useMissOnly=false){
  const { level, quizType, direction } = config;

  if(useMissOnly){
    const missList = Object.values(state.miss||{});
    const pool = missList.filter(w=>w.level === level);
    return pool.length ? pool : missList;
  }

  if(quizType === "mix"){
    // mix ignores direction here, but still filtered by level
    return pickWordsByLevel(level);
  }

  return pickWordsByLevel(level);
}

function choiceQuestion(word, dir, pool){
  const askEnToJa = (dir === "en_to_ja");
  const prompt = askEnToJa ? `英単語：${word.en}` : `日本語：${word.ja}`;
  const correct = askEnToJa ? word.ja : word.en;

  // distractors: same direction answer field
  const field = askEnToJa ? "ja" : "en";
  const candidates = shuffle(pool.filter(w=>keyOfWord(w)!==keyOfWord(word))).slice(0,3);
  const options = shuffle([correct, ...candidates.map(w=>w[field])]);

  return {
    kind: "mc",
    prompt,
    options,
    correctSet: new Set([norm(correct)]),
    meta: { word, dir }
  };
}

function typingQuestion(word, dir){
  const askEnToJa = (dir === "en_to_ja");
  const prompt = askEnToJa ? `英単語：${word.en}` : `日本語：${word.ja}`;
  const correct = askEnToJa ? word.ja : word.en;

  return {
    kind: "typing",
    prompt,
    correctSet: new Set([norm(correct)]),
    showMeaning: askEnToJa ? "" : `意味：${word.ja}`,
    example: askEnToJa ? `例）${word.ja}` : `例）${word.en}`,
    meta: { word, dir }
  };
}

function mixFormQuestion(pool){
  // pick a verb with forms
  const verbs = pool.filter(w=>w.forms && w.forms.base && w.forms.past && w.forms.pp);
  const word = verbs[Math.floor(Math.random()*verbs.length)];

  // pick which form to show (base/past/pp)
  const forms = word.forms;
  const keys = ["base","past","pp"];
  const showKey = keys[Math.floor(Math.random()*keys.length)];
  const shown = String(forms[showKey]);

  // Determine correct labels. If multiple forms equal shown, accept all matching.
  const correctKeys = keys.filter(k => norm(forms[k]) === norm(shown));
  const labelOf = (k)=>{
    if(k==="base") return "現在形";
    if(k==="past") return "過去形";
    return "過去分詞";
  };

  const correctLabels = correctKeys.map(labelOf);
  const options = shuffle(["現在形","過去形","過去分詞","（その他）"]).slice(0,4);
  // ensure all 3 labels are present and 4th is "（その他）"
  const baseOpts = shuffle(["現在形","過去形","過去分詞"]);
  const opts = shuffle([...baseOpts, "（その他）"]);

  return {
    kind: "mc",
    prompt: `「${shown}」はどの形？（${word.en}：${word.ja}）`,
    options: opts,
    correctSet: new Set(correctLabels.map(norm)),
    meta: { word, mix: "form", shown, correctLabels }
  };
}

function mixSeriesTypingQuestion(pool){
  // Ask: 【series】 ja は英語で？
  const word = pool[Math.floor(Math.random()*pool.length)];
  const prompt = `【${word.series}】「${word.ja}」は英語で？`;
  return {
    kind: "typing",
    prompt,
    correctSet: new Set([norm(word.en)]),
    showMeaning: `（日→英 固定）`,
    example: `例）${word.en}`,
    meta: { word, mix: "series" }
  };
}

function makeQuizQuestions(config, useMissOnly=false){
  const pool = buildQuestionPool(config, useMissOnly);
  if(pool.length < 6){
    // fallback: ignore level
    const all = useMissOnly ? Object.values(state.miss||{}) : WORDS;
    return makeQuizQuestions({ ...config, level: config.level }, useMissOnly); // still try
  }

  const qs = [];
  if(config.quizType === "mc"){
    const base = shuffle(pool).slice(0,10);
    for(const w of base){
      qs.push(choiceQuestion(w, config.direction, pool));
    }
  }else if(config.quizType === "typing"){
    const base = shuffle(pool).slice(0,10);
    for(const w of base){
      qs.push(typingQuestion(w, config.direction));
    }
  }else{ // mix
    // 5 form + 5 series
    for(let i=0;i<5;i++){
      qs.push(mixFormQuestion(pool));
    }
    for(let i=0;i<5;i++){
      qs.push(mixSeriesTypingQuestion(pool));
    }
    return shuffle(qs);
  }
  return qs;
}

// ---- Quiz runtime ----
let quiz = null; // { config, questions, idx, ok, missesThisRun: Set<key>, lock:bool, autoTimer:number|null }

function setLock(v){
  quiz.lock = v;
  els.checkBtn.disabled = v;
  els.nextBtn.disabled = v && quiz && quiz.idx < quiz.questions.length-1; // allow next after lock? we'll control separately
}

function showFeedback(ok, msg){
  els.feedback.className = `feedback ${ok ? "ok" : "ng"}`;
  els.feedback.textContent = msg;
}

function clearFeedback(){
  els.feedback.className = "feedback";
  els.feedback.textContent = "";
}

function updateProgress(){
  els.progress.textContent = `${quiz.idx+1} / ${quiz.questions.length}`;
}

function renderQuestion(){
  clearFeedback();
  setLock(false);
  els.nextBtn.disabled = true;

  const q = quiz.questions[quiz.idx];
  els.qText.textContent = q.prompt;
  els.qTypePill.textContent =
    (quiz.config.quizType === "mc") ? "4択" :
    (quiz.config.quizType === "typing") ? "打ち込み" :
    (q.meta.mix === "form") ? "形（4択）" : "系（日→英）";

  updateProgress();

  // reset UI
  els.choices.innerHTML = "";
  els.typing.classList.add("hidden");
  els.choices.classList.add("hidden");
  els.typeMeaning.textContent = "";
  els.typeExample.textContent = "";
  els.typeInput.value = "";

  if(q.kind === "mc"){
    els.choices.classList.remove("hidden");
    q.options.forEach((opt)=>{
      const btn = document.createElement("button");
      btn.className = "choiceBtn";
      btn.type = "button";
      btn.textContent = opt;
      btn.onclick = ()=> submitAnswer(opt);
      els.choices.appendChild(btn);
    });
  }else{
    els.typing.classList.remove("hidden");
    els.typeMeaning.textContent = q.showMeaning || "";
    els.typeExample.textContent = q.example || "";
    // focus after render
    setTimeout(()=>els.typeInput.focus(), 0);
  }
}

function recordAnswer(ok, word){
  state.totalAns += 1;
  if(ok) state.totalOk += 1;

  state.recent = (state.recent || []).concat([ok]).slice(-50);

  if(!ok && word){
    const k = keyOfWord(word);
    if(!state.miss[k]){
      state.miss[k] = { ...word, misses: 0 };
    }
    state.miss[k].misses = (state.miss[k].misses || 0) + 1;
    quiz.missesThisRun.add(k);
  }
  saveState();
  updateRankUI();
}

function submitAnswer(rawAnswer){
  if(quiz.lock) return;
  const q = quiz.questions[quiz.idx];

  // Normalize and check
  const ans = norm(rawAnswer);
  const ok = q.correctSet.has(ans);

  // Lock to prevent double scoring
  quiz.lock = true;

  // Mark choices
  if(q.kind === "mc"){
    [...els.choices.querySelectorAll("button")].forEach(btn=>{
      btn.disabled = true;
      const v = norm(btn.textContent);
      if(q.correctSet.has(v)) btn.classList.add("isCorrect");
      if(v === ans && !q.correctSet.has(v)) btn.classList.add("isWrong");
    });
  }else{
    els.typeInput.disabled = true;
    els.checkBtn.disabled = true;
  }

  // Feedback message
  if(ok){
    showFeedback(true, "正解！");
  }else{
    const corrects = [...q.correctSet].map(s=>s); // already norm
    const pretty = (()=>{
      // show original forms if possible
      if(q.kind === "typing"){
        // display one representative correct (first)
        // try to show from word fields
        const w = q.meta.word;
        if(w){
          const dir = q.meta.dir;
          const askEnToJa = (dir === "en_to_ja");
          return askEnToJa ? w.ja : w.en;
        }
      }
      if(q.meta && q.meta.correctLabels) return q.meta.correctLabels.join(" / ");
      return corrects[0] || "";
    })();
    showFeedback(false, `不正解… 正解：${pretty}`);
  }

  recordAnswer(ok, q.meta.word);

  // Enable Next
  els.nextBtn.disabled = false;

  // Auto-advance
  const delay = ok ? 650 : 950;
  if(quiz.autoTimer) clearTimeout(quiz.autoTimer);
  quiz.autoTimer = setTimeout(()=>{
    if(!els.quiz.classList.contains("hidden")){
      goNext();
    }
  }, delay);
}

function goNext(){
  if(quiz.autoTimer){ clearTimeout(quiz.autoTimer); quiz.autoTimer = null; }
  const q = quiz.questions[quiz.idx];
  // reset typing lock
  els.typeInput.disabled = false;
  els.checkBtn.disabled = false;

  if(quiz.idx < quiz.questions.length-1){
    quiz.idx += 1;
    renderQuestion();
  }else{
    finishQuiz();
  }
}

function finishQuiz(){
  // Result screen
  const ok = quiz.questions.length - quiz.missesThisRun.size; // rough (miss set counts words, not questions)
  // better: count from this run by tracking ok count
  const total = quiz.questions.length;
  const recentRunOk = quiz.questions.reduce((acc, q, i)=>acc, 0);

  const misses = [...quiz.missesThisRun].map(k=>state.miss[k]).filter(Boolean);
  const missWords = misses
    .sort((a,b)=>(b.misses||0)-(a.misses||0))
    .slice(0,50);

  // Build result text: compute run accuracy from state recent diff? We'll store run stats in quiz
  const acc = Math.round((quiz.okCount / total)*100);
  els.resultText.textContent = `正解：${quiz.okCount} / ${total}（${acc}%）`;

  // miss list
  els.missList.innerHTML = "";
  if(missWords.length === 0){
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "ミスはありませんでした。";
    els.missList.appendChild(div);
  }else{
    missWords.forEach(w=>{
      const row = document.createElement("div");
      row.className = "missItem";
      row.innerHTML = `<div class="missEn">${escapeHtml(w.en)}</div><div class="missJa">${escapeHtml(w.ja)}</div><div class="missMeta">Lv${w.level} / ${escapeHtml(w.series)} / ミス${w.misses||1}</div>`;
      els.missList.appendChild(row);
    });
  }

  screen("result");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

// ---- Event wiring ----
function buildLevelOptions(){
  els.level.innerHTML = "";
  const labels = [
    { v: 1, t: "レベル1（基礎）" },
    { v: 2, t: "レベル2（標準）" },
    { v: 3, t: "レベル3（発展）" },
  ];
  labels.forEach(o=>{
    const opt = document.createElement("option");
    opt.value = String(o.v);
    opt.textContent = o.t;
    els.level.appendChild(opt);
  });
}

function applyLastConfigToUI(){
  const c = state.lastConfig || { level: 1, quizType:"mc", direction:"en_to_ja" };
  els.level.value = String(c.level ?? 1);
  els.quizType.value = c.quizType ?? "mc";
  els.direction.value = c.direction ?? "en_to_ja";
  updateDirectionHint();
}

function readConfigFromUI(){
  return {
    level: Number(els.level.value)||1,
    quizType: els.quizType.value,
    direction: els.direction.value,
  };
}

function updateDirectionHint(){
  const qt = els.quizType.value;
  const disabled = (qt === "mix");
  els.direction.disabled = disabled;
  els.directionHint.style.opacity = disabled ? "1" : "0.7";
}

function startQuiz({ useMissOnly=false } = {}){
  const config = readConfigFromUI();
  state.lastConfig = { ...config };
  saveState();

  const questions = makeQuizQuestions(config, useMissOnly);
  quiz = {
    config,
    questions,
    idx: 0,
    okCount: 0,
    missesThisRun: new Set(),
    lock: false,
    autoTimer: null,
  };

  // patch submitAnswer to count ok
  const origSubmit = submitAnswer;
  // We'll not monkeypatch; instead wrap by checking in submitAnswer itself:
  // But easiest: compute okCount after evaluation here:
  // We'll do by intercepting in submitAnswer: (implemented below) -> not possible now.
  // We'll implement okCount update in a small hook by storing lastOk in quiz.
  // (See below: we adjust in submitAnswer by comparing state totals? no.)
  // We'll instead set a flag on q when answered.
  quiz.questions.forEach(q=>{ q._answered = false; q._ok = false; });

  // move
  screen("quiz");
  renderQuestion();
}

function attachSubmitCounting(){
  // Wrap submitAnswer once
  const orig = submitAnswer;
  window.__submitWrapped = true;
}

els.saveUserBtn.onclick = ()=>{
  state.userName = (els.userName.value||"").trim().slice(0,20);
  saveState();
  showFeedback(true, "保存しました");
  setTimeout(()=>clearFeedback(), 800);
};

els.quizType.onchange = updateDirectionHint;

els.startBtn.onclick = ()=> startQuiz({ useMissOnly:false });
els.startBtn2.onclick = ()=> startQuiz({ useMissOnly:false });

els.reviewBtn.onclick = ()=> startQuiz({ useMissOnly:true });

els.backBtn.onclick = ()=>{
  if(quiz && quiz.autoTimer){ clearTimeout(quiz.autoTimer); }
  screen("setup");
  clearFeedback();
};

els.backBtn2.onclick = ()=>{
  screen("setup");
};

els.quitBtn.onclick = ()=>{
  if(quiz && quiz.autoTimer){ clearTimeout(quiz.autoTimer); }
  screen("result");
};

els.nextBtn.onclick = ()=> goNext();

els.checkBtn.onclick = ()=>{
  if(quiz.lock) return;
  const v = els.typeInput.value;
  submitAnswer(v);
};

// Enter key for typing
els.typeInput.addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    e.preventDefault();
    if(!quiz.lock) submitAnswer(els.typeInput.value);
  }
});

els.retryMissBtn.onclick = ()=>{
  // Start quiz using miss words only, keeping last config
  applyLastConfigToUI();
  startQuiz({ useMissOnly:true });
};

els.resetBtn.onclick = ()=>{
  if(!confirm("保存データ（正答数・ミス・ランク）を初期化します。よろしいですか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  applyLastConfigToUI();
  els.userName.value = "";
  updateRankUI();
  showFeedback(true, "初期化しました");
  setTimeout(()=>clearFeedback(), 900);
};

// ---- SubmitAnswer with run okCount ----
// (We need okCount; implement by overriding submitAnswer reference above.)
const _submitAnswerOriginal = submitAnswer;
submitAnswer = function(rawAnswer){
  if(quiz.lock) return;
  const q = quiz.questions[quiz.idx];
  const ans = norm(rawAnswer);
  const ok = q.correctSet.has(ans);

  // mark run stats once
  if(!q._answered){
    q._answered = true;
    q._ok = ok;
    if(ok) quiz.okCount += 1;
  }

  // proceed with original (but it will recompute ok; that's fine)
  return _submitAnswerOriginal(rawAnswer);
};

// ---- init ----
async function init(){
  state = loadState();

  buildLevelOptions();
  applyLastConfigToUI();

  els.userName.value = state.userName || "";

  updateRankUI();
  screen("setup");
  updateDirectionHint();

  try{
    WORDS = await loadWords();
  }catch(err){
    alert(String(err && err.message ? err.message : err));
  }
}

init();
