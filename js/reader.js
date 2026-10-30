/**
 * 阅读页：epub.js 渲染，主题跟随站点明暗，其余排版参数在齿轮浮层里调。
 * 依赖：js/vendor/jszip.min.js + js/vendor/epub.min.js（classic script，先于本模块执行）
 */
import { loadBooks } from "./data-loader.js";

const SETTINGS_KEY = "jianzhu-reader-settings";
const THEME_KEY = "jianzhu-theme";

const DEFAULTS = {
  font: "serif",
  size: 18,
  lineHeight: 19,   // 实际值 /10
  paragraph: 12,    // 实际值 /10
  margin: 48,
  flow: "paginated",
  focus: false,         // 聚焦阅读
  focusCount: 1,        // 一次聚焦几段
  focusDim: 30,         // 非聚焦内容的不透明度（%）
  focusBg: "#f7e2b0",   // 聚焦底色
  focusFg: "#1f1b16"    // 聚焦文字色
};

const FONT_STACKS = {
  serif: '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
  sans: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif'
};

/* 参数优先 query，其次 hash（clean-url 服务器会丢掉 .html 后的 query） */
function readParam(key) {
  const fromQuery = new URLSearchParams(location.search);
  if (fromQuery.get(key)) return fromQuery.get(key);
  return new URLSearchParams(location.hash.replace(/^#/, "")).get(key);
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    /* 隐私模式忽略 */
  }
}

const progressKey = (id) => `jianzhu-progress:${id}`;

export async function initReader() {
  const viewer = document.querySelector("[data-reader-viewer]");
  const stage = document.querySelector("[data-reader-stage]");
  const titleEl = document.querySelector("[data-reader-title]");
  const backEl = document.querySelector("[data-reader-back]");
  const panel = document.querySelector("[data-reader-panel]");
  const settingsBtn = document.querySelector("[data-reader-settings]");
  const themeBtn = document.querySelector("[data-reader-theme]");
  const prevBtn = document.querySelector("[data-reader-prev]");
  const nextBtn = document.querySelector("[data-reader-next]");
  const progressInput = document.querySelector("[data-reader-progress]");
  const progressLabel = document.querySelector("[data-reader-progress-label]");
  const statusEl = document.querySelector("[data-reader-status]");
  const hintEl = document.querySelector("[data-reader-hint]");
  const focusToggle = document.querySelector("[data-focus-toggle]");
  const focusOptions = document.querySelectorAll("[data-focus-options]");
  const focusCountChips = document.querySelectorAll("[data-focus-count] [data-count]");
  const focusBgInput = document.querySelector("[data-focus-bg]");
  const focusFgInput = document.querySelector("[data-focus-fg]");

  const showStatus = (text) => {
    if (!statusEl) return;
    if (text) {
      statusEl.textContent = text;
      statusEl.hidden = false;
      statusEl.classList.remove("is-leaving");
    } else {
      statusEl.classList.add("is-leaving");
      window.setTimeout(() => {
        statusEl.hidden = true;
      }, 240);
    }
  };

  const id = readParam("id");
  if (!id) {
    showStatus("缺少书籍参数");
    return;
  }
  if (!window.ePub) {
    showStatus("阅读组件加载失败，请刷新重试");
    return;
  }

  let data;
  try {
    data = await loadBooks();
  } catch (err) {
    showStatus("书籍数据加载失败，请刷新重试");
    return;
  }
  const book = (data.books || []).find((item) => item.id === id);
  if (!book) {
    showStatus("没有找到这本书");
    return;
  }
  const epubFile = (book.files || []).find((file) => /\.epub$/i.test(file.path || ""));
  if (!epubFile) {
    showStatus("这本书还没有 EPUB 源文件");
    return;
  }

  document.title = `荐书 · 阅读《${book.title || ""}》`;
  if (titleEl) titleEl.textContent = book.title || "";
  const from = readParam("from");
  if (backEl) {
    backEl.href = `book.html#id=${encodeURIComponent(id)}${from ? `&from=${encodeURIComponent(from)}` : ""}`;
  }

  const settings = loadSettings();
  let rendition = null;
  let currentCfi = null;
  try {
    currentCfi = localStorage.getItem(progressKey(id));
  } catch (err) {
    currentCfi = null;
  }

  /* ---------- 主题 ---------- */

  function palette() {
    const dark = document.documentElement.dataset.theme === "dark";
    return dark
      ? { bg: "#12100c", fg: "#efe9e0", link: "#d9c3a3" }
      : { bg: "#f8f6f1", fg: "#1f1b16", link: "#8f7a55" };
  }

  function bookStyles() {
    const color = palette();
    return {
      "html, body": {
        background: `${color.bg} !important`,
        color: `${color.fg} !important`,
        padding: "0 !important",
        margin: "0 !important"
      },
      body: {
        "font-family": `${FONT_STACKS[settings.font] || FONT_STACKS.serif} !important`,
        "line-height": `${(settings.lineHeight / 10).toFixed(1)} !important`,
        "text-align": "justify",
        "word-break": "break-word"
      },
      "p, div, li, dd, td": {
        "line-height": `${(settings.lineHeight / 10).toFixed(1)} !important`,
        "margin-bottom": `${(settings.paragraph / 10).toFixed(1)}em !important`
      },
      "img, svg, video, image": {
        "max-width": "100% !important",
        height: "auto !important"
      },
      "a, a:visited": {
        color: `${color.link} !important`,
        "text-decoration": "none !important"
      },
      "h1, h2, h3, h4": {
        "font-family": `${FONT_STACKS.serif} !important`,
        color: `${color.fg} !important`,
        "line-height": "1.5 !important"
      }
    };
  }

  /* ---------- 进度 ---------- */

  function applyProgress(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    if (progressInput) progressInput.value = String(Math.round(clamped * 10));
    if (progressLabel) progressLabel.textContent = `${Math.round(clamped)}%`;
  }

  /* 百分比一律用定位表算：epub.js 的 location.start.percentage 在定位表生成前恒为 0 */
  function updateProgress() {
    if (!rendition) return;
    const location = rendition.currentLocation() || {};
    const cfi = (location.start && location.start.cfi) || currentCfi;
    if (!cfi) return;
    if (epub.locations && epub.locations.length()) {
      try {
        const percent = epub.locations.percentageFromCfi(cfi);
        if (Number.isFinite(percent)) {
          applyProgress(percent * 100);
          return;
        }
      } catch (err) {
        /* cfi 还没进表，等下一次 */
      }
    }
    if (location.start && typeof location.start.percentage === "number" && location.start.percentage > 0) {
      applyProgress(location.start.percentage * 100);
    }
  }

  function onRelocated(location) {
    if (!location || !location.start) return;
    currentCfi = location.start.cfi;
    // 换章节后需要重新挑聚焦段落（内容和 DOM 都换了一批）
    if (location.start.href !== lastHref) {
      lastHref = location.start.href;
      window.setTimeout(() => applyFocus(false), 60);
    }
    try {
      localStorage.setItem(progressKey(id), currentCfi);
    } catch (err) {
      /* 忽略 */
    }
    updateProgress();
  }

  /* ---------- 聚焦阅读 ---------- */

  const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, td";
  let focusIndex = 0;          // 当前聚焦块在该章节里的序号
  let pendingFocus = null;     // "first" | "last"：翻到新章节后从哪头开始
  let lastHref = null;         // 上一次渲染的章节，用来判断是否换章

  function currentContents() {
    if (!rendition) return null;
    const list = rendition.getContents();
    if (!list || !list.length) return null;
    return list[list.length - 1];
  }

  function blocksOf(doc) {
    return Array.from(doc.querySelectorAll(BLOCK_SELECTOR)).filter(
      (node) => (node.textContent || "").trim().length > 0
    );
  }

  /* 把聚焦样式注入书内文档（不做 reflow，靠 box-shadow 撑出底色） */
  function injectFocusStyle(contents) {
    const doc = contents.document || contents;
    if (!doc || !doc.head) return;
    let style = doc.getElementById("reader-focus-style");
    if (!style) {
      style = doc.createElement("style");
      style.id = "reader-focus-style";
      doc.head.appendChild(style);
    }
    const dim = Math.max(0.1, Math.min(0.9, (settings.focusDim || 30) / 100));
    style.textContent = `
      body[data-reader-focus="on"] :is(${BLOCK_SELECTOR}) {
        opacity: ${dim} !important;
        transition: opacity .28s ease, background-color .28s ease, color .28s ease;
      }
      body[data-reader-focus="on"] :is(${BLOCK_SELECTOR}).reader-focus-target {
        opacity: 1 !important;
        background-color: ${settings.focusBg} !important;
        color: ${settings.focusFg} !important;
        border-radius: 4px;
        box-shadow: 0 0 0 0.55em ${settings.focusBg};
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
      }
    `;
  }

  /* 聚焦块不在可视区时，翻到它所在的那一页 */
  function revealBlock(target) {
    const contents = currentContents();
    if (!target || !contents || !rendition) return;
    const doc = contents.document || contents;
    const rect = target.getBoundingClientRect();
    const view = doc.defaultView || window;
    const visible =
      rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth;
    if (visible) return;
    if (typeof contents.cfiFromNode !== "function") return;
    try {
      const cfi = contents.cfiFromNode(target);
      if (cfi) rendition.display(cfi);
    } catch (err) {
      /* 忽略 */
    }
  }

  function applyFocus(preserveIndex = true) {
    const contents = currentContents();
    if (!contents) return;
    const doc = contents.document || contents;
    if (!doc || !doc.body) return;

    injectFocusStyle(contents);
    doc.body.dataset.readerFocus = settings.focus ? "on" : "off";
    doc.querySelectorAll(".reader-focus-target").forEach((node) => node.classList.remove("reader-focus-target"));

    if (!settings.focus) {
      if (hintEl) hintEl.hidden = true;
      return;
    }

    const blocks = blocksOf(doc);
    if (!blocks.length) return;
    if (!preserveIndex && pendingFocus === "last") focusIndex = blocks.length - 1;
    else if (!preserveIndex) focusIndex = 0;
    pendingFocus = null;
    focusIndex = Math.max(0, Math.min(blocks.length - 1, focusIndex));

    const count = Math.max(1, Number(settings.focusCount) || 1);
    for (let i = 0; i < count; i += 1) {
      const target = blocks[focusIndex + i];
      if (target) target.classList.add("reader-focus-target");
    }

    if (hintEl) {
      hintEl.hidden = false;
      hintEl.classList.remove("is-faded");
      window.clearTimeout(hintEl.__timer);
      hintEl.__timer = window.setTimeout(() => hintEl.classList.add("is-faded"), 2600);
    }
  }

  /* 上下键移动聚焦；走到章节两端就翻页 */
  function moveFocus(delta) {
    if (!settings.focus) return false;
    const contents = currentContents();
    const doc = contents && (contents.document || contents);
    if (!doc || !doc.body) return false;
    const blocks = blocksOf(doc);
    if (!blocks.length) return false;

    const nextIndex = focusIndex + delta;
    if (nextIndex < 0) {
      pendingFocus = "last";
      if (rendition) rendition.prev();
      return true;
    }
    if (nextIndex >= blocks.length) {
      pendingFocus = "first";
      if (rendition) rendition.next();
      return true;
    }

    focusIndex = nextIndex;
    applyFocus(true);
    revealBlock(blocks[focusIndex]);
    return true;
  }

  /* ---------- 渲染 ---------- */

  function buildRendition() {
    if (rendition) {
      try {
        rendition.destroy();
      } catch (err) {
        /* 忽略 */
      }
      rendition = null;
    }
    viewer.replaceChildren();

    rendition = epub.renderTo(viewer, {
      width: "100%",
      height: "100%",
      flow: settings.flow === "scrolled" ? "scrolled-doc" : "paginated",
      spread: "none",
      allowScriptedContent: false
    });
    rendition.themes.default(bookStyles());
    rendition.themes.fontSize(`${settings.size}px`);
    rendition.on("relocated", onRelocated);
    rendition.hooks.content.register((contents) => {
      const doc = contents.document || contents;
      if (!doc || !doc.addEventListener) return;
      doc.addEventListener("keydown", onKeyDown);
      doc.addEventListener("click", (event) => {
        if (!settings.focus) return;
        const block = event.target.closest && event.target.closest(BLOCK_SELECTOR);
        if (!block) return;
        const blocks = blocksOf(doc);
        const index = blocks.indexOf(block);
        if (index < 0) return;
        focusIndex = index;
        applyFocus(true);
      });
      injectFocusStyle(contents);
      applyFocus(false);
    });
    // epub.js 只按首次测到的高度铺 iframe，布局晚一点就得手动 resize
    rendition.display(currentCfi || undefined);
    requestAnimationFrame(() => {
      try {
        rendition.resize();
      } catch (err) {
        /* 忽略 */
      }
    });
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!rendition) return;
      try {
        rendition.resize();
      } catch (err) {
        /* 忽略 */
      }
    }, 180);
  });

  const epub = window.ePub(epubFile.path);
  // 调试出口：控制台里可以直接看 epub / rendition 状态
  window.__reader = {
    get epub() { return epub; },
    get rendition() { return rendition; },
    get cfi() { return currentCfi; }
  };
  epub.ready.then(() => {
    showStatus(null);
    buildRendition();
    // 生成定位表后才能按百分比跳转
    epub.locations
      .generate(1200)
      .then(() => updateProgress())
      .catch(() => {});
  });

  /* ---------- 设置 ---------- */

  function syncUi() {
    document.querySelectorAll("[data-font]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.font === settings.font);
    });
    document.querySelectorAll("[data-flow]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.flow === settings.flow);
    });
    if (focusToggle) focusToggle.setAttribute("aria-checked", String(!!settings.focus));
    focusOptions.forEach((node) => {
      node.hidden = !settings.focus;
    });
    document.querySelectorAll("[data-focus-count] [data-count]").forEach((chip) => {
      chip.classList.toggle("is-active", Number(chip.dataset.count) === Number(settings.focusCount));
    });
    if (focusBgInput && focusBgInput.value !== settings.focusBg) focusBgInput.value = settings.focusBg;
    if (focusFgInput && focusFgInput.value !== settings.focusFg) focusFgInput.value = settings.focusFg;

    document.querySelectorAll("[data-setting]").forEach((input) => {
      const key = input.dataset.setting;
      if (key && settings[key] != null) input.value = String(settings[key]);
      const label = document.querySelector(`[data-setting-value="${key}"]`);
      if (label && key) {
        if (key === "focusDim") label.textContent = String(settings[key]);
        else if (key === "size" || key === "margin") label.textContent = String(settings[key]);
        else label.textContent = (settings[key] / 10).toFixed(1);
      }
    });
    if (stage) stage.style.setProperty("--reader-margin", `${settings.margin}px`);
  }

  let rebuildTimer = 0;
  function queueRebuild() {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      if (!rendition) return;
      buildRendition();
    }, 220);
  }

  function applyChange(options = {}) {
    saveSettings(settings);
    syncUi();
    if (options.focusOnly) {
      applyFocus(true);
      return;
    }
    queueRebuild();
  }

  /* 聚焦类设置：直接改书内样式，不用重建 */
  if (focusToggle) {
    focusToggle.addEventListener("click", () => {
      settings.focus = !settings.focus;
      if (settings.focus) focusIndex = focusIndex || 0;
      applyChange({ focusOnly: true });
      if (settings.focus) {
        const contents = currentContents();
        const doc = contents && (contents.document || contents);
        const blocks = doc && doc.body ? blocksOf(doc) : [];
        if (blocks.length) revealBlock(blocks[Math.min(focusIndex, blocks.length - 1)]);
      }
    });
  }

  document.querySelectorAll("[data-focus-count] [data-count]").forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.focusCount = Number(chip.dataset.count) || 1;
      applyChange({ focusOnly: true });
    });
  });

  if (focusBgInput) {
    focusBgInput.addEventListener("input", () => {
      settings.focusBg = focusBgInput.value;
      applyChange({ focusOnly: true });
    });
  }

  if (focusFgInput) {
    focusFgInput.addEventListener("input", () => {
      settings.focusFg = focusFgInput.value;
      applyChange({ focusOnly: true });
    });
  }

  document.querySelectorAll("[data-font]").forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.font = chip.dataset.font;
      applyChange();
    });
  });

  document.querySelectorAll("[data-flow]").forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.flow = chip.dataset.flow;
      applyChange();
    });
  });

  document.querySelectorAll("[data-setting]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.setting;
      settings[key] = Number(input.value);
      // 弱化程度只影响书内样式，不需要重建
      applyChange(key === "focusDim" ? { focusOnly: true } : undefined);
    });
  });

  if (settingsBtn && panel) {
    settingsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      settingsBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || event.target.closest("[data-reader-settings]")) return;
      panel.hidden = true;
      settingsBtn.setAttribute("aria-expanded", "false");
    });
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (err) {
        /* 忽略 */
      }
      queueRebuild();
    });
  }

  /* ---------- 翻页 ---------- */

  function next() {
    if (settings.flow === "scrolled") {
      stage.scrollBy({ top: stage.clientHeight * 0.9, behavior: "smooth" });
      return;
    }
    if (rendition) rendition.next();
  }

  function prev() {
    if (settings.flow === "scrolled") {
      stage.scrollBy({ top: -stage.clientHeight * 0.9, behavior: "smooth" });
      return;
    }
    if (rendition) rendition.prev();
  }

  function onKeyDown(event) {
    if (settings.focus && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      prev();
    } else if (event.key === "Escape" && panel) {
      panel.hidden = true;
    }
  }

  document.addEventListener("keydown", onKeyDown);
  if (prevBtn) prevBtn.addEventListener("click", prev);
  if (nextBtn) nextBtn.addEventListener("click", next);

  let pointerStartX = 0;
  let pointerStartY = 0;
  stage.addEventListener("pointerdown", (event) => {
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
  });
  stage.addEventListener("pointerup", (event) => {
    const dx = event.clientX - pointerStartX;
    const dy = event.clientY - pointerStartY;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) next();
    else prev();
  });

  if (progressInput) {
    let seekTimer = 0;
    const seek = () => {
      if (!rendition || !epub.locations || !epub.locations.length()) return;
      const cfi = epub.locations.cfiFromPercentage(Number(progressInput.value) / 1000);
      if (cfi) rendition.display(cfi);
    };
    progressInput.addEventListener("input", () => {
      const value = Number(progressInput.value) / 10;
      if (progressLabel) progressLabel.textContent = `${Math.round(value)}%`;
      window.clearTimeout(seekTimer);
      seekTimer = window.setTimeout(seek, 160);
    });
  }

  syncUi();
}