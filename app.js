/* Vocab Trainer Next (GitHub Pages / No build) */

const $ = (q) => document.querySelector(q);

const VIEWS = {
  home: $("#viewHome"),
  quiz: $("#viewQuiz"),
  result: $("#viewResult"),
};

const UI = {
  rankName: $("#rankName"),
  rankDot: $("#rankDot"),
  accText: $("#accText"),
  streakText: $("#streakText"),

  wordsMeta: $("#wordsMeta"),
  totalAns: $("#totalAns"),
  lifeAcc: $("#lifeAcc"),
  rollAcc: $("#rollAcc"),
  rp: $("#rp"),

  modeLabel: $("#modeLabel"),
  qnoLabel: $("#qnoLabel"),
  promptText: $("#promptText"),

  mcqArea: $("#mcqArea"),
  choiceList: $("#choiceList"),

  typingArea: $("#typingArea"),
  typingInput: $("#typingInput"),
  submitTyping: $("#submitTyping"),

  feedbackBox: $("#feedbackBox"),
  progressBar: $("#progressBar"),

  resultScore: $("#resultScore"),
  resultDetail: $("#resultDetail"),
  rankExplain: $("#rankExplain"),
};

const STORAGE_KEYS = {
  stats: "vtn_stats_v1",
  lastConfig: "vtn_last_config_v1",
};

const ROLLING_N = 50;
const QUIZ_LEN = 10;

let WORDS = [];
let session = null;

/** ---------------------------
 *  Stats + Rank
 *  --------------------------*/
function defaultStats(){
  return {
    total: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    rolling: [],       // array of 0/1 (latest last)
    rankPoints: 0,     // relaxed score-ish progression
    rank: "BRONZE",
    history: []        // export-friendly small log
  };
}

function loadStats(){
  try{
    const raw = localStorage.getItem(STORAGE_KEYS.stats);
    if(!raw) return defaultStats();
    const s = JSON.parse(raw);
    return { ...defaultStats(), ...s };
  }catch{
    return defaultStats();
  }
}

function saveStats(s){
  localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(s));
}

function pct(n, d){
  if(d <= 0) return 0;
  return (n / d) * 100;
}

function rollingAccuracy(stats){
  const a = stats.rolling;
  if(!a || a.length === 0) return null;
  const sum = a.reduce((x,y)=>x+y,0);
  return pct(sum, a.length);
}

const RANKS = [
  { key:"BRONZE",  name:"Bronze",  minRP:0,   upAcc:62, downAcc:0,  dot:"warn" },
  { key:"SILVER",  name:"Silver",  minRP:40,  upAcc:70, downAcc:56, dot:"ok" },
  { key:"GOLD",    name:"Gold",    minRP:90,  upAcc:78, downAcc:64, dot:"ok" },
  { key:"PLATINUM",name:"Platinum",minRP:150, upAcc:84, downAcc:72, dot:"ok" },
  { key:"DIAMOND", name:"Diamond", minRP:220, upAcc:88, downAcc:78, dot:"ok" }
];

// dot color helper
function setRankDot(kind){
  if(kind === "ok") UI.rankDot.style.background = "var(--ok)";
  else if(kind === "ng") UI.rankDot.style.background = "var(--ng)";
  else UI.rankDot.style.background = "var(--warn)";
}

function computeRank(stats){
  // relaxed: use BOTH rankPoints and rolling accuracy
  const rAcc = rollingAccuracy(stats);
  const hasEnough = stats.total >= 20 && (stats.rolling?.length ?? 0) >= 20;
  const currentIdx = Math.max(0, RANKS.findIndex(r => r.key === stats.rank));
  let idx = currentIdx;

  if(hasEnough && rAcc != null){
    // promotion check (can step up multiple if strong)
    while(idx < RANKS.length - 1){
      const next = RANKS[idx + 1];
      if(stats.rankPoints >= next.minRP && rAcc >= next.upAcc) idx++;
      else break;
    }
    // demotion check (one step at a time to avoid thrash)
    const cur = RANKS[idx];
    if(idx > 0 && rAcc < cur.downAcc){
      idx--;
    }
  }else{
    // early stage: only rankPoints
    while(idx < RANKS.length - 1 && stats.rankPoints >= RANKS[idx + 1].minRP){
      idx++;
    }
  }

  return RANKS[idx];
}

function updateTopBar(stats){
  const r = computeRank(stats);
  stats.rank = r.key;

  UI.rankName.textContent = r.name;

  const rAcc = rollingAccuracy(stats);
  UI.accText.textContent = (rAcc == null) ? "直近：—" : `直近：${rAcc.toFixed(0)}%`;
  UI.streakText.textContent = `連続：${stats.streak}`;

  setRankDot(r.dot);
}

function updateHomeStats(stats){
  UI.totalAns.textContent = String(stats.total);
  UI.lifeAcc.textContent = (stats.total ? `${pct(stats.correct, stats.total).toFixed(1)}%` : "—");
  const rAcc = rollingAccuracy(stats);
  UI.rollAcc.textContent = (rAcc == null) ? "—" : `${rAcc.toFixed(1)}%`;
  UI.rp.textContent = String(stats.rankPoints);
}

/** ---------------------------
 *  Words Loading
 *  --------------------------*/
async function loadWords(){
  const res = await fetch("./words.json", { cache:"no-store" });
  if(!res.ok) throw new Error("words.json の読み込みに失敗しました");
  const data = await res.json();
  if(!Array.isArray(data)) throw new Error("words.json は配列である必要があります");
  // normalize
  WORDS = data
    .filter(w => w && typeof w.en === "string" && typeof w.ja === "string")
    .map(w => ({
      en: w.en.trim(),
      ja: w.ja.trim(),
      level: Number(w.level ?? 1),
      series: (w.series ?? "").toString().trim(),
      forms: w.forms ? {
        base: (w.forms.base ?? w.en).toString().trim(),
        past: (w.forms.past ?? "").toString().trim(),
        pp: (w.forms.pp ?? "").toString().trim()
      } : null
    }))
    .filter(w => w.en && w.ja);

  const lvCount = [1,2,3].map(l => WORDS.filter(w=>w.level===l).length);
  UI.wordsMeta.textContent = `単語数: ${WORDS.length}（Lv1:${lvCount[0]} Lv2:${lvCount[1]} Lv3:${lvCount[2]}）`;
}

/** ---------------------------
 *  Utilities
 *  --------------------------*/
function shuffle(a){
  const arr = a.slice();
  for(let i=arr.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sample(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

function pickDistinct(arr, n, keyFn = (x)=>x){
  const used = new Set();
  const out = [];
  const pool = shuffle(arr);
  for(const x of pool){
    const k = keyFn(x);
    if(used.has(k)) continue;
    used.add(k);
    out.push(x);
    if(out.length >= n) break;
  }
  return out;
}

function normalizeAnswer(s){
  return (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function showView(name){
  Object.values(VIEWS).forEach(v => v.classList.add("hidden"));
  VIEWS[name].classList.remove("hidden");
}

/** ---------------------------
 *  Question builders
 *  --------------------------*/
function poolByLevel(level){
  const lv = Number(level);
  const p = WORDS.filter(w => (w.level ?? 1) === lv);
  // fallback if insufficient
  return (p.length >= 8) ? p : WORDS;
}

function makeMcqQuestion(dir, level){
  const pool = poolByLevel(level);
  const correct = sample(pool);
  const isJa2En = dir === "ja2en";

  const prompt = isJa2En ? correct.ja : correct.en;
  const correctText = isJa2En ? correct.en : correct.ja;

  const distractPool = pool.filter(w => w.en !== correct.en);
  const d = pickDistinct(distractPool, 3, (w)=> isJa2En ? w.en : w.ja);
  const choices = shuffle([correctText, ...d.map(w => isJa2En ? w.en : w.ja)]);

  return {
    type: "mcq",
    prompt,
    choices,
    answer: correctText,
    meta: { word: correct }
  };
}

function makeTypingQuestion(dir, level){
  const pool = poolByLevel(level);
  const correct = sample(pool);
  const isJa2En = dir === "ja2en";

  return {
    type: "typing",
    prompt: isJa2En ? correct.ja : correct.en,
    answer: isJa2En ? correct.en : correct.ja,
    meta: { word: correct, dir }
  };
}

function makeVerbFormQuestion(){
  // needs forms: base/past/pp
  const candidates = WORDS.filter(w => w.forms && w.forms.past && w.forms.pp);
  const w = candidates.length ? sample(candidates) : null;
  if(!w){
    // fallback to normal mcq if not enough data
    return makeMcqQuestion("ja2en", 2);
  }

  const forms = [
    { key:"base", label:"現在形" },
    { key:"past", label:"過去形" },
    { key:"pp",   label:"過去分詞" }
  ];
  const chosen = sample(forms);

  // show the actual string of that form; ask which form it is
  const shown = w.forms[chosen.key] || w.en;
  const prompt = `「${w.en}」の形：${shown}\nこれは何形？`;

  return {
    type: "mcq",
    prompt,
    choices: shuffle(forms.map(f=>f.label)),
    answer: chosen.label,
    meta: { word: w, verbForm: chosen.key }
  };
}

function makeSeriesQuestion(){
  // "○○の〇系は(日→英)？" -> implement as: (meaning) + [series] => pick English
  const candidates = WORDS.filter(w => w.series && w.series.length > 0);
  const w = candidates.length ? sample(candidates) : null;
  if(!w){
    // fallback
    return makeMcqQuestion("ja2en", 2);
  }
  const pool = candidates.filter(x => x.series === w.series);
  const distractPool = WORDS.filter(x => x.en !== w.en);

  const d = pickDistinct(distractPool, 3, (x)=>x.en);
  const choices = shuffle([w.en, ...d.map(x=>x.en)]);

  const prompt = `「${w.ja}」の【${w.series}】は？（日→英）`;

  return {
    type: "mcq",
    prompt,
    choices,
    answer: w.en,
    meta: { word: w, series: w.series }
  };
}

function buildSession(config){
  // config: { mode, dir, level }
  const questions = [];
  if(config.mode === "mcq"){
    for(let i=0;i<QUIZ_LEN;i++) questions.push(makeMcqQuestion(config.dir, config.level));
  }else if(config.mode === "typing"){
    for(let i=0;i<QUIZ_LEN;i++) questions.push(makeTypingQuestion(config.dir, config.level));
  }else if(config.mode === "mix"){
    // 5 verb form + 5 series
    for(let i=0;i<5;i++) questions.push(makeVerbFormQuestion());
    for(let i=0;i<5;i++) questions.push(makeSeriesQuestion());
    // shuffle within mix
    return { ...config, questions: shuffle(questions), idx:0, correct:0, answered:0, log:[] };
  }
  return { ...config, questions, idx:0, correct:0, answered:0, log:[] };
}

/** ---------------------------
 *  Quiz rendering + answering
 *  --------------------------*/
function setFeedback(text, kind){
  UI.feedbackBox.textContent = text ?? "";
  UI.feedbackBox.classList.remove("ok","ng");
  if(kind) UI.feedbackBox.classList.add(kind);
}

function setProgress(i, total){
  const p = total ? (i / total) * 100 : 0;
  UI.progressBar.style.width = `${p}%`;
}

function renderQuestion(){
  const q = session.questions[session.idx];
  const total = session.questions.length;

  UI.modeLabel.textContent = session.mode === "mcq" ? "4択" :
                             session.mode === "typing" ? "打ち込み" : "ミックス";
  UI.qnoLabel.textContent = `${session.idx + 1} / ${total}`;
  UI.promptText.textContent = q.prompt;

  setFeedback("", null);
  setProgress(session.idx, total);

  // areas
  UI.mcqArea.classList.add("hidden");
  UI.typingArea.classList.add("hidden");

  if(q.type === "mcq"){
    UI.mcqArea.classList.remove("hidden");
    UI.choiceList.innerHTML = "";
    q.choices.forEach(choice => {
      const b = document.createElement("button");
      b.className = "choiceBtn";
      b.textContent = choice;
      b.onclick = () => answerMcq(choice, b);
      UI.choiceList.appendChild(b);
    });
  }else{
    UI.typingArea.classList.remove("hidden");
    UI.typingInput.value = "";
    UI.typingInput.focus();
    UI.submitTyping.disabled = false;
  }
}

function lockChoices(){
  const btns = UI.choiceList.querySelectorAll("button");
  btns.forEach(b => b.disabled = true);
}

function answerMcq(choice, btnEl){
  const q = session.questions[session.idx];
  const correct = (choice === q.answer);

  lockChoices();

  // mark UI
  const btns = UI.choiceList.querySelectorAll("button");
  btns.forEach(b => {
    if(b.textContent === q.answer) b.classList.add("correct");
    if(b.textContent === choice && !correct) b.classList.add("wrong");
  });

  onAnswered(correct, choice, q.answer);

  setFeedback(correct ? "正解" : `不正解（正解: ${q.answer}）`, correct ? "ok" : "ng");

  // auto next
  window.setTimeout(nextQuestion, 900);
}

function answerTyping(){
  const q = session.questions[session.idx];
  const given = UI.typingInput.value;
  const correct = normalizeAnswer(given) === normalizeAnswer(q.answer);

  // prevent multi-add
  UI.submitTyping.disabled = true;

  onAnswered(correct, given, q.answer);

  setFeedback(correct ? "正解" : `不正解（正解: ${q.answer}）`, correct ? "ok" : "ng");

  window.setTimeout(nextQuestion, 1100);
}

function onAnswered(isCorrect, given, expected){
  session.answered++;
  if(isCorrect) session.correct++;

  session.log.push({
    t: Date.now(),
    mode: session.mode,
    given,
    expected,
    ok: isCorrect
  });
}

function nextQuestion(){
  session.idx++;
  if(session.idx >= session.questions.length){
    finishSession();
  }else{
    renderQuestion();
  }
}

/** ---------------------------
 *  Scoring + RankPoints + Result
 *  --------------------------*/
function finishSession(){
  const stats = loadStats();
  const total = session.questions.length;
  const ok = session.correct;
  const acc = pct(ok, total);

  // relaxed rankPoints:
  // + correct * 2
  // + bonus for high accuracy
  // - small penalty for low accuracy
  let deltaRP = ok * 2;
  if(acc >= 90) deltaRP += 12;
  else if(acc >= 80) deltaRP += 8;
  else if(acc >= 70) deltaRP += 4;
  else if(acc < 50) deltaRP -= 4;

  // update stats
  for(const r of session.log){
    stats.total += 1;
    if(r.ok){
      stats.correct += 1;
      stats.streak += 1;
      if(stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
      stats.rolling.push(1);
    }else{
      stats.streak = 0;
      stats.rolling.push(0);
    }
    if(stats.rolling.length > ROLLING_N) stats.rolling.shift();
  }

  stats.rankPoints = Math.max(0, stats.rankPoints + deltaRP);

  // rank recompute (includes possible demotion)
  const before = stats.rank;
  const r = computeRank(stats);
  stats.rank = r.key;

  stats.history.push({
    at: new Date().toISOString(),
    mode: session.mode,
    config: { dir: session.dir ?? null, level: session.level ?? null },
    total, ok, acc: Math.round(acc),
    deltaRP,
    rankBefore: before,
    rankAfter: stats.rank
  });
  // keep history small
  if(stats.history.length > 200) stats.history.shift();

  saveStats(stats);
  updateTopBar(stats);
  updateHomeStats(stats);

  // render result
  UI.resultScore.textContent = `${ok} / ${total}`;
  UI.resultDetail.textContent = `正答率 ${acc.toFixed(1)}%  /  RP ${deltaRP >= 0 ? "+" : ""}${deltaRP}`;

  const rAcc = rollingAccuracy(stats);
  UI.rankExplain.textContent =
    `判定は「直近正答率（最大${ROLLING_N}問）」と「ランクポイント」で行います。` +
    `\n直近正答率: ${rAcc == null ? "—" : rAcc.toFixed(1) + "%"} / RP: ${stats.rankPoints}` +
    `\nランク: ${RANKS.find(x=>x.key===before)?.name ?? before} → ${RANKS.find(x=>x.key===stats.rank)?.name ?? stats.rank}`;

  // store last config for retry
  localStorage.setItem(STORAGE_KEYS.lastConfig, JSON.stringify({
    mode: session.mode,
    dir: session.dir ?? null,
    level: session.level ?? null
  }));

  showView("result");
}

/** ---------------------------
 *  Events
 *  --------------------------*/
async function startApp(){
  const stats = loadStats();
  updateTopBar(stats);
  updateHomeStats(stats);

  try{
    await loadWords();
  }catch(e){
    UI.wordsMeta.textContent = `words.json 読み込み失敗: ${e.message}`;
  }

  // Home buttons
  $("#startMcq").onclick = () => {
    session = buildSession({
      mode: "mcq",
      dir: $("#mcqDir").value,
      level: Number($("#mcqLevel").value),
    });
    showView("quiz");
    renderQuestion();
  };

  $("#startTyping").onclick = () => {
    session = buildSession({
      mode: "typing",
      dir: $("#typeDir").value,
      level: Number($("#typeLevel").value),
    });
    showView("quiz");
    renderQuestion();
  };

  $("#startMix").onclick = () => {
    session = buildSession({ mode: "mix" });
    showView("quiz");
    renderQuestion();
  };

  $("#reloadWords").onclick = async () => {
    UI.wordsMeta.textContent = "再読み込み中…";
    try{
      await loadWords();
    }catch(e){
      UI.wordsMeta.textContent = `再読み込み失敗: ${e.message}`;
    }
  };

  $("#resetStats").onclick = () => {
    if(!confirm("成績をリセットします。よろしいですか？")) return;
    const s = defaultStats();
    saveStats(s);
    updateTopBar(s);
    updateHomeStats(s);
  };

  $("#exportStats").onclick = () => {
    const s = loadStats();
    const blob = new Blob([JSON.stringify(s, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vocab_trainer_stats.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Quiz buttons
  $("#backHome").onclick = () => { showView("home"); };
  UI.submitTyping.onclick = answerTyping;
  UI.typingInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !UI.submitTyping.disabled) answerTyping();
  });

  // Result buttons
  $("#goHome").onclick = () => showView("home");
  $("#retrySame").onclick = () => {
    const raw = localStorage.getItem(STORAGE_KEYS.lastConfig);
    if(!raw){ showView("home"); return; }
    const cfg = JSON.parse(raw);
    session = buildSession(cfg);
    showView("quiz");
    renderQuestion();
  };

  showView("home");
}

startApp();
