(function () {
  const decks = {
    english: (typeof ENGLISH_WORDS !== "undefined" ? ENGLISH_WORDS : []).slice(),
    chinese: (typeof CHINESE_WORDS !== "undefined" ? CHINESE_WORDS : []).slice(),
  };

  let current = "english";
  let index = 0;

  const $ = (id) => document.getElementById(id);
  const card = $("card");
  const scene = $("scene");
  const empty = $("empty");
  const controls = $("controls");

  function render() {
    const list = decks[current];
    const total = list.length;

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
    controls.querySelectorAll("button").forEach((b) => (b.disabled = false));
    $("prev").disabled = index === 0;
    $("next").disabled = index === total - 1;

    const w = list[index];
    // Wait for the flip-back before swapping the back text, so it isn't revealed early
    $("front-word").textContent = w.word || "";
    $("front-pinyin").textContent = w.pinyin || "";
    setTimeout(() => {
      $("back-pos").textContent = w.pos || "";
      $("back-thai").textContent = w.thai || "";
      $("back-meaning").textContent = w.meaning || "";
      $("back-example").textContent = w.example || "";
    }, 150);

    $("counter").textContent = `${index + 1} / ${total}`;
    $("progress-bar").style.width = `${((index + 1) / total) * 100}%`;
  }

  function flip() {
    if (decks[current].length) card.classList.toggle("flipped");
  }
  function next() {
    if (index < decks[current].length - 1) { index++; render(); }
  }
  function prev() {
    if (index > 0) { index--; render(); }
  }
  function shuffle() {
    const list = decks[current];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    index = 0;
    render();
  }

  card.addEventListener("click", flip);
  $("next").addEventListener("click", next);
  $("prev").addEventListener("click", prev);
  $("shuffle").addEventListener("click", shuffle);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      current = tab.dataset.deck;
      index = 0;
      render();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); flip(); }
    else if (e.code === "ArrowRight") next();
    else if (e.code === "ArrowLeft") prev();
  });

  render();
})();
