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

  // ---------- Card state ----------
  let current = "english";
  let deck = [];
  let index = 0;

  function buildDeck() {
    deck = builtIn[current].concat(custom[current]);
  }

  const card = $("card");
  const scene = $("scene");
  const empty = $("empty");
  const controls = $("controls");

  function render() {
    const total = deck.length;
    if (index >= total) index = Math.max(0, total - 1);

    scene.classList.toggle("chinese", current === "chinese");
    card.classList.remove("flipped");

    if (total === 0) {
      scene.classList.add("hidden");
      empty.classList.remove("hidden");
      $("counter").textContent = "0 / 0";
      $("progress-bar").style.width = "0%";
      controls.querySelectorAll("button").forEach((b) => (b.disabled = true));
      return;
    }

    scene.classList.remove("hidden");
    empty.classList.add("hidden");
    $("shuffle").disabled = total < 2;
    $("prev").disabled = index === 0;
    $("next").disabled = index === total - 1;

    const w = deck[index];
    $("front-word").textContent = w.word || "";
    $("front-pinyin").textContent = w.pinyin || "";
    // Swap the back after the card turns back over, so the answer isn't revealed early
    setTimeout(() => {
      $("back-pos").textContent = w.pos || "";
      $("back-thai").textContent = w.thai || "";
      $("back-meaning").textContent = w.meaning || "";
      $("back-example").textContent = w.example || "";
    }, 150);

    $("counter").textContent = `${index + 1} / ${total}`;
    $("progress-bar").style.width = `${((index + 1) / total) * 100}%`;
  }

  function flip() { if (deck.length) card.classList.toggle("flipped"); }
  function next() { if (index < deck.length - 1) { index++; render(); } }
  function prev() { if (index > 0) { index--; render(); } }
  function shuffle() {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    index = 0;
    render();
  }

  function switchDeck(name) {
    current = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.deck === name));
    index = 0;
    buildDeck();
    render();
  }

  card.addEventListener("click", flip);
  $("next").addEventListener("click", next);
  $("prev").addEventListener("click", prev);
  $("shuffle").addEventListener("click", shuffle);
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchDeck(tab.dataset.deck)));

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return;
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
      buildDeck();
      render();
      renderList();
      toast("Saved ✓");
    } else {
      // Jump to the new card
      if (deckName !== current) switchDeck(deckName); else buildDeck();
      index = deck.length - 1;
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

    const all = builtIn[current].concat(custom[current]);
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
        tag.textContent = "from words.js";
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

  // ---------- Start ----------
  buildDeck();
  render();
})();
