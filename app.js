(function () {
  const STORAGE_KEY = "flashcards.myWords.v1";
  const $ = (id) => document.getElementById(id);

  // ---------- Data ----------
  const builtIn = {
    english: (typeof ENGLISH_WORDS !== "undefined" ? ENGLISH_WORDS : []).map((w) => ({ ...w, builtIn: true })),
    chinese: (typeof CHINESE_WORDS !== "undefined" ? CHINESE_WORDS : []).map((w) => ({ ...w, builtIn: true })),
  };

  function loadCustom() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.english) && Array.isArray(data.chinese)) return data;
    } catch (e) { /* storage unavailable or corrupt */ }
    return { english: [], chinese: [] };
  }
  let custom = loadCustom();

  function saveCustom() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
      return true;
    } catch (e) {
      toast("Couldn't save in this browser");
      return false;
    }
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- State ----------
  const MODES = ["quiz", "speak", "cards"];
  const MISTAKES = "__mistakes";
  const MY = "My words";
  let current = "english";
  let deck = [];       // cards in this round (a word can appear again as a review copy)
  let index = 0;
  let filter = "all";
  let mode = "quiz";
  let answered = false;
  let answers = {};    // results for this round, by card position

  // Scores: points are shared, each game keeps its own counts and streaks
  const score = {
    points: 0,
    quiz: { right: 0, wrong: 0, streak: 0, best: 0 },
    speak: { good: 0, again: 0, streak: 0, best: 0 },
  };

  // ---------- Saved progress ----------
  const PROGRESS_KEY = "flashcards.progress.v2";
  let P = {};
  try { P = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { P = {}; }
  P.filters = P.filters || {};
  P.places = P.places || {};
  // mistakes: { quiz: { english: {key: timesWrong}, chinese: {...} }, speak: {...} }
  P.mistakes = P.mistakes || {};
  ["quiz", "speak"].forEach((g) => {
    P.mistakes[g] = P.mistakes[g] || {};
    ["english", "chinese"].forEach((l) => { P.mistakes[g][l] = P.mistakes[g][l] || {}; });
  });
  if (P.score) {
    score.points = P.score.points || 0;
    Object.assign(score.quiz, P.score.quiz || {});
    Object.assign(score.speak, P.score.speak || {});
  }
  if (P.current === "english" || P.current === "chinese") current = P.current;
  if (MODES.includes(P.mode)) mode = P.mode;
  filter = P.filters[current] || "all";

  const keyOf = (w) => (w.word || "") + "|" + (w.thai || "").slice(0, 30);
  const placeKey = () => `${current}|${filter}|${mode}`;
  const game = () => (mode === "speak" ? "speak" : "quiz"); // which mistake list applies
  const mistakes = () => P.mistakes[game()][current];

  let saveTimer;
  let ready = false; // don't save until the saved place has been loaded
  function saveProgress() {
    if (!ready) return;
    P.current = current;
    P.mode = mode;
    P.filters[current] = filter;
    P.places[placeKey()] = { order: deck.map((w) => (w._review ? "R:" : "") + keyOf(w)), index, answers };
    P.score = score;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(P)); } catch (e) { /* storage full or blocked */ }
    }, 150);
  }

  const tagOf = (w) => w.tag || (w.builtIn ? "Other" : MY);
  const allWords = () => builtIn[current].concat(custom[current]);

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function filteredWords() {
    if (filter === MISTAKES) {
      const m = mistakes();
      return allWords().filter((w) => m[keyOf(w)]);
    }
    return allWords().filter((w) => filter === "all" || tagOf(w) === filter);
  }

  function buildDeck() {
    const list = filteredWords();
    const place = P.places[placeKey()];
    if (place && Array.isArray(place.order) && place.order.length) {
      // put the cards back in the order you were using last time
      const byKey = new Map();
      list.forEach((w) => { const k = keyOf(w); if (!byKey.has(k)) byKey.set(k, w); });
      const used = new Set();
      deck = [];
      place.order.forEach((k) => {
        const review = k.startsWith("R:");
        const w = byKey.get(review ? k.slice(2) : k);
        if (!w) return;
        if (review) deck.push({ ...w, _review: true });
        else if (!used.has(w)) { deck.push(w); used.add(w); }
      });
      const rest = list.filter((w) => !used.has(w));
      deck.push(...(mode === "cards" ? rest : shuffleArray(rest)));
      index = Math.min(place.index || 0, Math.max(0, deck.length - 1));
      answers = place.answers || {};
    } else {
      deck = list.slice();
      if (mode !== "cards") shuffleArray(deck);
      index = 0;
      answers = {};
    }
  }

  function updateFilter() {
    const sel = $("filter");
    const counts = {};
    allWords().forEach((w) => { counts[tagOf(w)] = (counts[tagOf(w)] || 0) + 1; });
    const nMist = Object.keys(mistakes()).length;
    if (filter !== "all" && filter !== MISTAKES && !counts[filter]) filter = "all";
    sel.innerHTML = "";
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      sel.appendChild(o);
    };
    add("all", `All words (${allWords().length})`);
    Object.keys(counts).forEach((t) => add(t, `${t} (${counts[t]})`));
    if (mode !== "cards") add(MISTAKES, mode === "speak" ? `🔁 Practise again (${nMist})` : `🔁 My mistakes (${nMist})`);
    else if (filter === MISTAKES) filter = "all";
    sel.value = filter;
  }

  // ---------- Card ----------
  const card = $("card");
  const scene = $("scene");
  const empty = $("empty");
  const controls = $("controls");

  // Each time a new card is shown this number goes up, so timers from an old card do nothing
  let cardToken = 0;
  let flipTimer = null;
  let backReadyAt = 0;
  let result = { text: "", cls: "result" };
  let shownAt = 0;

  // Keep the page where it is when the card changes (iPhone Safari sometimes jumps to the top)
  function keepScroll(y) {
    const fix = () => { if (Math.abs(window.scrollY - y) > 20) window.scrollTo(0, y); };
    fix();
    requestAnimationFrame(() => { fix(); requestAnimationFrame(fix); });
    [60, 150, 300, 500].forEach((t) => setTimeout(fix, t));
  }

  function render() {
    const scrollY0 = window.scrollY;
    if (document.activeElement && document.activeElement !== document.body) {
      try { document.activeElement.blur({ preventScroll: true }); } catch (e) { document.activeElement.blur(); }
    }
    shownAt = Date.now();
    cardToken++;
    const myToken = cardToken;
    clearTimeout(flipTimer);
    if (window.speechSynthesis) speechSynthesis.cancel();
    const total = deck.length;
    if (index >= total) index = Math.max(0, total - 1);

    scene.classList.toggle("chinese", current === "chinese");
    const wasFlipped = card.classList.contains("flipped");
    card.classList.remove("flipped");
    result = { text: "", cls: "result" };
    answered = false;
    $("next").classList.remove("pulse");
    $("speak-result").textContent = "";
    $("speak-result").className = "speak-result";

    if (total === 0) {
      scene.classList.add("hidden");
      empty.classList.remove("hidden");
      const mist = filter === MISTAKES;
      $("empty-title").textContent = mist ? "Nothing to review 🎉" : "No words yet";
      $("empty-text").innerHTML = mist
        ? "ไม่มีคำที่ต้องทบทวน — you've fixed all your mistakes!<br />Pick another word set to keep playing."
        : "ยังไม่มีคำศัพท์ในชุดนี้<br />Click <strong>＋ Add word</strong> to make your first card.";
      $("counter").textContent = "0 / 0";
      $("progress-bar").style.width = "0%";
      controls.querySelectorAll("button").forEach((b) => (b.disabled = true));
      $("choices").replaceChildren();
      $("swipe-btns").querySelectorAll("button").forEach((b) => (b.disabled = true));
      updateScore();
      return;
    }

    scene.classList.remove("hidden");
    empty.classList.add("hidden");
    $("shuffle").disabled = total < 2;
    $("prev").disabled = index === 0;
    $("next").disabled = mode === "quiz" ? true : false;
    $("swipe-btns").querySelectorAll("button").forEach((b) => (b.disabled = false));

    const w = deck[index];
    const tag = w._review ? "🔁 Review" : tagOf(w) === "Other" ? "" : tagOf(w);
    $("front-tag").textContent = tag;
    $("front-tag").classList.toggle("review", !!w._review);
    $("front-word").textContent = w.word || "";
    $("front-pinyin").textContent = w.pinyin || "";
    // Swap the back only after the card has fully turned back over (0.6s),
    // so the next word's answer is never visible while it rotates
    const delay = wasFlipped ? 650 : 0;
    backReadyAt = Date.now() + delay;
    const fillBack = () => {
      if (myToken !== cardToken) return;
      $("back-pos").textContent = w.pos || "";
      const th = w.thai || "";
      $("back-thai").textContent = th;
      $("back-thai").className = "thai" + (th.length > 70 ? " long" : th.length > 28 ? " medium" : "");
      const back = document.querySelector(".back");
      if (back.scrollTop) back.scrollTop = 0;
      $("back-meaning").textContent = w.meaning || "";
      $("back-example").textContent = w.example || "";
      $("back-result").textContent = result.text;
      $("back-result").className = result.cls;
    };
    if (mode === "quiz") buildChoices(w); else $("choices").replaceChildren();
    if (mode === "speak") showSpeakState();
    if (delay) setTimeout(fillBack, delay); else fillBack();

    $("counter").textContent = `${index + 1} / ${total}`;
    $("progress-bar").style.width = `${((index + 1) / total) * 100}%`;
    updateScore();
    if (ready) keepScroll(scrollY0);
  }

  let swipedAt = 0;
  function flip() {
    if (!deck.length) return;
    if (Date.now() - swipedAt < 400) return; // the tap was the end of a swipe
    if (mode === "quiz" && !answered) return; // pick an answer first
    card.classList.toggle("flipped");
  }

  function newRound() {
    deck = filteredWords().slice();
    if (mode !== "cards") shuffleArray(deck);
    answers = {};
    index = 0;
    render();
  }

  function next() {
    if (index < deck.length - 1) { index++; render(); }
    else if (mode !== "cards" && deck.length > 0) {
      const fixedAll = filter === MISTAKES && filteredWords().length === 0;
      newRound();
      toast(fixedAll ? "All mistakes fixed! 🎉" : "Round complete! 🎉 Shuffled for a new round");
    }
  }
  function prev() { if (index > 0) { index--; render(); } }

  // ---------- Mistakes come back later ----------
  function addMistake(w) {
    const m = mistakes();
    const k = keyOf(w);
    m[k] = (m[k] || 0) + 1;
    // put a review copy 3–6 cards later, unless one is already waiting
    const waiting = deck.some((c, i) => i > index && c._review && keyOf(c) === k);
    if (!waiting) {
      const gap = 3 + Math.floor(Math.random() * 4);
      const at = Math.min(deck.length, index + 1 + gap);
      deck.splice(at, 0, { ...w, _review: true });
      // cards after the insert point moved one place later, so move their saved results too
      const moved = {};
      Object.keys(answers).forEach((k) => { const n = +k; moved[n >= at ? n + 1 : n] = answers[k]; });
      answers = moved;
    }
    updateFilterCount();
  }
  function clearMistake(w) {
    const m = mistakes();
    if (m[keyOf(w)]) { delete m[keyOf(w)]; updateFilterCount(); return true; }
    return false;
  }
  function updateFilterCount() {
    const opt = [...$("filter").options].find((o) => o.value === MISTAKES);
    if (opt) {
      const n = Object.keys(mistakes()).length;
      opt.textContent = mode === "speak" ? `🔁 Practise again (${n})` : `🔁 My mistakes (${n})`;
    }
  }

  // ---------- Points ----------
  function gain(n, label) {
    if (n <= 0) return;
    score.points += n;
    const g = $("s-gain");
    g.textContent = `+${n}${label ? " " + label : ""}`;
    g.classList.remove("show"); void g.offsetWidth; g.classList.add("show");
  }

  function updateScore() {
    const q = score.quiz, s = score.speak;
    $("s-points").textContent = score.points;
    const tot = q.right + q.wrong;
    $("s-acc").textContent = tot ? Math.round((q.right / tot) * 100) + "%" : "–";
    $("s-good").textContent = s.good;
    const st = mode === "speak" ? s : q;
    $("s-streak").textContent = st.streak;
    $("s-best").textContent = st.best;
    $("s-review").textContent = Object.keys(mistakes()).length;
    saveProgress();
  }
  function bump() {
    const bar = $("scorebar");
    bar.classList.remove("bump"); void bar.offsetWidth; bar.classList.add("bump");
  }

  // ---------- Quiz game ----------
  const short = (t) => {
    let s = (t || "").split(" / ")[0].trim();
    if (s.length > 48) s = s.slice(0, 48).replace(/[,\s][^,\s]*$/, "") + "…";
    return s;
  };

  let currentChoice = null;

  function makeButtons(options, answer) {
    const frag = document.createDocumentFragment();
    options.forEach((txt, i) => {
      const b = document.createElement("button");
      b.className = "choice";
      b.innerHTML = `<span class="key">${i + 1}</span>`;
      b.appendChild(document.createTextNode(txt));
      b.dataset.correct = txt === answer ? "1" : "";
      b.dataset.token = cardToken;
      b.dataset.text = txt;
      b.addEventListener("click", () => choose(b));
      frag.appendChild(b);
    });
    $("choices").replaceChildren(frag); // swapped at once, so the page height never drops
  }

  function markChoices(pickedBtn) {
    $("choices").querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      if (b.dataset.correct === "1") b.classList.add("correct");
      else if (b === pickedBtn) b.classList.add("wrong");
      else b.classList.add("dim");
    });
  }

  const resultFor = (ok, w) => ({
    text: ok
      ? (w && w._review ? "✅ Fixed it! แก้ได้แล้ว" : "✅ ถูกต้อง! Correct!")
      : "❌ ยังไม่ถูก — it will come back soon. The answer is:",
    cls: "result " + (ok ? "ok" : "no"),
  });

  function buildChoices(w) {
    const rec = answers[index];
    if (rec && Array.isArray(rec.opts)) {
      // already answered this round: show it locked, exactly as it was
      currentChoice = rec;
      makeButtons(rec.opts, rec.answer);
      const picked = [...$("choices").querySelectorAll(".choice")].find((b) => b.dataset.text === rec.pick);
      markChoices(picked);
      answered = true;
      result = resultFor(rec.pick === rec.answer, w);
      $("next").disabled = false;
      const myToken = cardToken;
      flipTimer = setTimeout(() => {
        if (myToken === cardToken) card.classList.add("flipped");
      }, Math.max(0, backReadyAt - Date.now()) + 30);
      return;
    }
    const answer = short(w.thai);
    const used = new Set([answer]);
    const picks = [];
    const tryPool = (pool) => {
      for (const o of shuffleArray(pool.slice())) {
        if (picks.length >= 3) break;
        const s = short(o.thai);
        if (keyOf(o) === keyOf(w) || !s || used.has(s)) continue;
        used.add(s); picks.push(s);
      }
    };
    const pool = deck.length >= 8 ? deck : allWords();
    const samePos = pool.filter((o) => o.pos && w.pos && o.pos.split(",")[0] === w.pos.split(",")[0]);
    tryPool(samePos.length >= 12 ? samePos : pool);
    if (picks.length < 3) tryPool(allWords());
    const options = shuffleArray([answer, ...picks]);
    currentChoice = { opts: options, answer };
    makeButtons(options, answer);
  }

  function choose(btn) {
    if (answered) return;
    // ignore taps that belong to a card that's already gone (e.g. two fingers at once)
    if (!btn.isConnected || +btn.dataset.token !== cardToken) return;
    if (Date.now() - shownAt < 250) return; // too soon after the card appeared: probably a stray tap
    answered = true;
    const w = deck[index];
    const ok = btn.dataset.correct === "1";
    markChoices(btn);
    answers[index] = { opts: currentChoice.opts, answer: currentChoice.answer, pick: btn.dataset.text };
    const q = score.quiz;
    if (ok) {
      q.right++; q.streak++;
      if (q.streak > q.best) q.best = q.streak;
      const fixed = clearMistake(w) || w._review;
      // 10 points, +1 for every answer in a row after the first (up to +10); fixing a mistake = 5
      const bonus = Math.min(q.streak - 1, 10);
      gain(fixed ? 5 + bonus : 10 + bonus, q.streak >= 3 ? `🔥${q.streak}` : "");
      bump();
    } else {
      q.wrong++; q.streak = 0;
      addMistake(w);
    }
    updateScore();
    $("counter").textContent = `${index + 1} / ${deck.length}`;
    result = resultFor(ok, w);
    if (Date.now() >= backReadyAt) {
      $("back-result").textContent = result.text;
      $("back-result").className = result.cls;
    }
    const myToken = cardToken;
    flipTimer = setTimeout(() => {
      if (myToken === cardToken) card.classList.add("flipped");
    }, Math.max(ok ? 350 : 650, backReadyAt - Date.now() + 30));
    $("next").disabled = false;
    $("next").classList.add("pulse");
  }

  // ---------- Speaking game ----------
  let voices = [];
  function loadVoices() { if (window.speechSynthesis) voices = speechSynthesis.getVoices(); }
  loadVoices();
  if (window.speechSynthesis && "onvoiceschanged" in speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;

  function pickVoice(lang) {
    const pre = lang.slice(0, 2).toLowerCase();
    const list = voices.filter((v) => (v.lang || "").toLowerCase().replace("_", "-").startsWith(pre));
    if (lang === "zh-CN") {
      return list.find((v) => /zh[-_]CN/i.test(v.lang)) || list.find((v) => !/HK|TW/i.test(v.lang)) || list[0];
    }
    return list.find((v) => /en[-_]US/i.test(v.lang)) || list[0];
  }

  function speak(slow) {
    const w = deck[index];
    if (!w) return;
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      toast("Sorry, this browser can't play pronunciation");
      return;
    }
    const lang = current === "chinese" ? "zh-CN" : "en-US";
    let text = (w.word || "").replace(/\s*\.\.\.\s*/g, " ").replace(/\(.*?\)/g, "").trim();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    else if (voices.length) toast(current === "chinese" ? "No Chinese voice on this device" : "No English voice on this device");
    u.rate = slow ? 0.55 : current === "chinese" ? 0.8 : 0.9;
    const btn = $("listen");
    u.onstart = () => btn.classList.add("playing");
    u.onend = u.onerror = () => btn.classList.remove("playing");
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  let lastListen = 0;
  $("listen").addEventListener("click", (e) => {
    e.stopPropagation();
    // tapping 🔊 twice quickly plays it slowly
    const now = Date.now();
    speak(now - lastListen < 1500);
    lastListen = now;
  });
  ["pointerdown", "touchstart", "mousedown"].forEach((ev) => $("listen").addEventListener(ev, (e) => e.stopPropagation()));

  function showSpeakState() {
    const rec = answers[index];
    const el = $("speak-result");
    if (rec && rec.said) {
      answered = true;
      el.textContent = rec.said === "good" ? "👍 You said this one well" : "🔁 Marked to practise again";
      el.className = "speak-result " + (rec.said === "good" ? "ok" : "no");
    }
  }

  function judge(good) {
    if (!deck.length || Date.now() - shownAt < 250) return;
    const w = deck[index];
    if (!answers[index]) {
      answers[index] = { said: good ? "good" : "again" };
      const s = score.speak;
      if (good) {
        s.good++; s.streak++;
        if (s.streak > s.best) s.best = s.streak;
        const fixed = clearMistake(w) || w._review;
        gain(fixed ? 3 : 5, fixed ? "fixed" : "");
        bump();
      } else {
        s.again++; s.streak = 0;
        addMistake(w);
      }
      updateScore();
    }
    flyAway(good);
  }

  function flyAway(good) {
    const myToken = cardToken;
    scene.style.transition = "transform 0.3s ease-in, opacity 0.3s";
    scene.style.transform = `translateX(${good ? 140 : -140}%) rotate(${good ? 18 : -18}deg)`;
    scene.style.opacity = "0";
    setStamps(good ? 1 : -1);
    setTimeout(() => {
      if (myToken !== cardToken) return;
      scene.style.transition = "none";
      scene.style.transform = "";
      scene.style.opacity = "";
      setStamps(0);
      next();
      requestAnimationFrame(() => { scene.style.transition = ""; });
    }, 280);
  }

  function setStamps(v) {
    $("stamp-good").style.opacity = v > 0 ? Math.min(1, v) : 0;
    $("stamp-again").style.opacity = v < 0 ? Math.min(1, -v) : 0;
  }

  // Swipe the card left / right (speaking game).
  // The card handles the touch itself (the page doesn't scroll by itself on the card),
  // so a slightly diagonal swipe moves only the card. A clearly up/down drag still scrolls the page.
  let drag = null;
  let glide = null;
  scene.addEventListener("pointerdown", (e) => {
    if (mode !== "speak" || !deck.length) return;
    if (e.target.closest("button")) return;
    if (glide) { cancelAnimationFrame(glide); glide = null; }
    drag = { x: e.clientX, y: e.clientY, lastY: e.clientY, lastT: performance.now(), vy: 0,
             id: e.pointerId, dx: 0, kind: null, touch: e.pointerType !== "mouse" };
  });
  scene.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.kind) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // sideways-ish (up to about 60° from flat) counts as a swipe
      drag.kind = Math.abs(dx) >= Math.abs(dy) * 0.6 ? "swipe" : "scroll";
      try { scene.setPointerCapture(e.pointerId); } catch (err) {}
      if (drag.kind === "swipe") scene.style.transition = "none";
    }
    if (drag.kind === "swipe") {
      drag.dx = dx;
      scene.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      setStamps(dx / 110);
    } else if (drag.touch) {
      // scroll the page ourselves
      const now = performance.now();
      const step = drag.lastY - e.clientY;
      window.scrollBy(0, step);
      drag.vy = step / Math.max(1, now - drag.lastT);
      drag.lastY = e.clientY; drag.lastT = now;
    }
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    if (!d.kind) return;
    swipedAt = Date.now();
    if (d.kind === "scroll") {
      // keep gliding a little after you let go, like normal scrolling
      let v = d.vy * 16;
      const step = () => {
        if (Math.abs(v) < 0.5) { glide = null; return; }
        window.scrollBy(0, v);
        v *= 0.94;
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
      return;
    }
    if (Math.abs(d.dx) > 90) {
      judge(d.dx > 0);
    } else {
      scene.style.transition = "transform 0.25s";
      scene.style.transform = "";
      setStamps(0);
    }
  };
  scene.addEventListener("pointerup", endDrag);
  scene.addEventListener("pointercancel", endDrag);
  $("good-btn").addEventListener("click", () => judge(true));
  $("again-btn").addEventListener("click", () => judge(false));

  // ---------- Modes ----------
  function setMode(m) {
    mode = m;
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    document.body.classList.toggle("quiz", m === "quiz");
    document.body.classList.toggle("speak", m === "speak");
    document.body.classList.toggle("cards", m === "cards");
    filter = P.filters[current] || "all";
    updateFilter();
    $("keys").textContent = m === "quiz"
      ? "1–4 = choose answer · Enter / → = next · L = listen"
      : m === "speak"
        ? "Say the word, tap 🔊 to check · swipe → or press → if good, swipe ← or press ← to practise again"
        : "Space = flip · ← → = previous / next · L = listen";
    buildDeck();
    render();
  }
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  function shuffle() {
    shuffleArray(deck);
    answers = {};
    index = 0;
    render();
  }

  function switchDeck(name) {
    current = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.deck === name));
    filter = P.filters[name] || "all";
    updateFilter();
    buildDeck();
    render();
  }

  $("filter").addEventListener("change", (e) => {
    filter = e.target.value;
    P.filters[current] = filter;
    buildDeck();
    render();
  });

  card.addEventListener("click", flip);
  $("next").addEventListener("click", next);
  $("prev").addEventListener("click", prev);
  $("shuffle").addEventListener("click", shuffle);
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchDeck(tab.dataset.deck)));

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.code === "KeyL" || e.code === "KeyP") { speak(false); return; }
    if (tag === "button" && (e.code === "Space" || e.code === "Enter")) return;
    if (mode === "quiz" && /^Digit[1-4]$/.test(e.code)) {
      const b = $("choices").querySelectorAll(".choice")[+e.code.slice(5) - 1];
      if (b) b.click();
      return;
    }
    if (mode === "speak") {
      if (e.code === "ArrowRight") { judge(true); return; }
      if (e.code === "ArrowLeft") { judge(false); return; }
    }
    if (mode === "quiz" && answered && (e.code === "Enter" || e.code === "ArrowRight")) { e.preventDefault(); next(); return; }
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flip(); }
    else if (e.code === "ArrowRight") next();
    else if (e.code === "ArrowLeft") prev();
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Add / edit form ----------
  const addDialog = $("add-dialog");
  const form = $("add-form");
  let editing = null; // { deck, id } when editing an existing word

  function updatePinyinRow() {
    $("pinyin-row").classList.toggle("hidden", $("f-deck").value !== "chinese");
  }
  $("f-deck").addEventListener("change", updatePinyinRow);

  function openForm(word, deckName) {
    form.reset();
    editing = word ? { deck: deckName, id: word.id } : null;
    $("form-title").textContent = word ? "Edit word · แก้ไขคำศัพท์" : "Add a word · เพิ่มคำศัพท์";
    $("save-word").textContent = word ? "Save changes" : "Save";
    $("f-deck").value = deckName || current;
    $("f-deck").disabled = !!word;
    if (word) {
      $("f-word").value = word.word || "";
      $("f-pinyin").value = word.pinyin || "";
      $("f-pos").value = word.pos || "";
      $("f-thai").value = word.thai || "";
      $("f-meaning").value = word.meaning || "";
      $("f-example").value = word.example || "";
    }
    updatePinyinRow();
    addDialog.showModal();
    $("f-word").focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const deckName = $("f-deck").value;
    const entry = {
      word: $("f-word").value.trim(),
      pos: $("f-pos").value.trim(),
      thai: $("f-thai").value.trim(),
      meaning: $("f-meaning").value.trim(),
      example: $("f-example").value.trim(),
    };
    if (deckName === "chinese" && $("f-pinyin").value.trim()) entry.pinyin = $("f-pinyin").value.trim();
    if (!entry.word || !entry.thai) return;

    if (editing) {
      const list = custom[editing.deck];
      const i = list.findIndex((w) => w.id === editing.id);
      if (i !== -1) list[i] = { ...entry, id: editing.id };
    } else {
      custom[deckName].push({ ...entry, id: newId() });
    }
    if (!saveCustom()) return;

    const wasEditing = !!editing;
    addDialog.close();

    if (wasEditing) {
      updateFilter();
      buildDeck();
      render();
      renderList();
      toast("Saved ✓");
    } else {
      // Jump to the new card
      if (deckName !== current) switchDeck(deckName);
      if (filter !== "all" && filter !== MY) { filter = "all"; }
      updateFilter();
      buildDeck();
      let i = deck.findIndex((x) => x.word === entry.word && x.thai === entry.thai);
      if (i === -1) { deck.push(custom[deckName][custom[deckName].length - 1]); i = deck.length - 1; }
      index = i;
      render();
      if ($("list-dialog").open) renderList();
      toast(`Added “${entry.word}” ✓`);
    }
  });

  $("cancel-add").addEventListener("click", () => addDialog.close());
  $("open-add").addEventListener("click", () => openForm(null, current));

  // ---------- Word list ----------
  const listDialog = $("list-dialog");

  function renderList() {
    const ul = $("word-list");
    ul.innerHTML = "";
    $("list-title").textContent = current === "chinese" ? "中文 word list" : "English word list";

    const all = filteredWords();
    if (all.length === 0) {
      const li = document.createElement("li");
      li.className = "w-empty";
      li.textContent = "No words yet. ยังไม่มีคำศัพท์";
      ul.appendChild(li);
      return;
    }

    all.forEach((w) => {
      const li = document.createElement("li");
      const main = document.createElement("div");
      main.className = "w-main";

      const word = document.createElement("div");
      word.className = "w-word";
      word.textContent = w.word + (w.pinyin ? `  (${w.pinyin})` : "");
      const thai = document.createElement("div");
      thai.className = "w-thai";
      thai.textContent = w.thai + (w.pos ? ` · ${w.pos}` : "");
      main.append(word, thai);

      if (w.builtIn) {
        const tag = document.createElement("div");
        tag.className = "w-tag";
        tag.textContent = w.tag ? `${w.tag} · words.js` : "from words.js";
        main.appendChild(tag);
      }
      li.appendChild(main);

      if (!w.builtIn) {
        const edit = document.createElement("button");
        edit.className = "small-btn";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => openForm(w, current));

        const del = document.createElement("button");
        del.className = "small-btn danger";
        del.textContent = "Delete";
        del.addEventListener("click", () => {
          if (del.dataset.confirm) {
            custom[current] = custom[current].filter((x) => x.id !== w.id);
            saveCustom();
            updateFilter();
            buildDeck();
            render();
            renderList();
            toast("Deleted");
          } else {
            del.dataset.confirm = "1";
            del.textContent = "Sure?";
            setTimeout(() => { delete del.dataset.confirm; del.textContent = "Delete"; }, 2500);
          }
        });
        li.append(edit, del);
      }
      ul.appendChild(li);
    });
  }

  $("open-list").addEventListener("click", () => { renderList(); listDialog.showModal(); });
  $("close-list").addEventListener("click", () => listDialog.close());

  // Backup: download all added words as a file
  $("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(custom, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "flashcards-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Restore: load a backup file (adds words that aren't already there)
  $("import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let added = 0;
        ["english", "chinese"].forEach((d) => {
          (Array.isArray(data[d]) ? data[d] : []).forEach((w) => {
            if (!w || !w.word || !w.thai) return;
            const exists = custom[d].some((x) => x.word === w.word && x.thai === w.thai);
            if (!exists) { custom[d].push({ ...w, id: newId() }); added++; }
          });
        });
        saveCustom();
        updateFilter();
        buildDeck();
        render();
        renderList();
        toast(`Restored ${added} word${added === 1 ? "" : "s"}`);
      } catch (err) {
        toast("That file isn't a valid backup");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // Copy added words as code to paste into words.js
  $("copy-code").addEventListener("click", async () => {
    const list = custom[current];
    if (!list.length) { toast("No added words in this deck"); return; }
    const code = list
      .map(({ id, ...w }) => {
        const parts = Object.entries(w)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
        return `  { ${parts.join(", ")} },`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(code);
      toast("Copied! Paste into words.js");
    } catch (e) {
      window.prompt("Copy this and paste it into words.js:", code);
    }
  });

  // ---------- Stop double-tap zoom on phones ----------
  // iPhone Safari can zoom when a button is tapped twice quickly, even with CSS rules.
  // If a second tap comes within 350ms, cancel the zoom and treat it as a normal tap.
  let lastTap = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTap < 350) {
      const el = e.target.closest("button, .card, select, input, textarea, label");
      if (!el || !el.matches("select, input, textarea")) {
        e.preventDefault();
        if (el && el.isConnected && Date.now() - swipedAt > 400) el.click();
      }
    }
    lastTap = now;
  }, { passive: false });

  // ---------- Reset ----------
  let confirmReset = false;
  $("reset-score").addEventListener("click", () => {
    if (!confirmReset) {
      confirmReset = true;
      $("reset-score").textContent = "Sure? tap again";
      setTimeout(() => { confirmReset = false; $("reset-score").textContent = "↺ Reset"; }, 2500);
      return;
    }
    confirmReset = false;
    $("reset-score").textContent = "↺ Reset";
    score.points = 0;
    score.quiz = { right: 0, wrong: 0, streak: 0, best: 0 };
    score.speak = { good: 0, again: 0, streak: 0, best: 0 };
    // unlock every answered card and remove waiting review copies, then start a fresh round
    Object.values(P.places).forEach((pl) => { if (pl) { pl.answers = {}; pl.order = []; } });
    newRound();
    toast("Score reset — new round! (your mistake list is kept)");
  });

  // ---------- Start ----------
  try { localStorage.removeItem("flashcards.progress.v1"); } catch (e) {}
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.deck === current));
  setMode(mode);
  ready = true;
  saveProgress();
})();
