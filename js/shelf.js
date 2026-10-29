import { loadBooks } from "./data-loader.js";
import { initSpoiler } from "./spoiler-particles.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_TRACE_MS = 3000;
const TRACE_PAD = 8;      // 描边层外扩，需与 css 里的 --trace-pad 一致
const RING_GAP = 0;       // 描边与卡片外缘的视觉间隙
const RING_STROKE = 2;    // 描边线宽，需与 css 一致
const FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)");
const NAVIGATION_ENTRY = performance.getEntriesByType("navigation")[0];
let suppressHoverUntilLeave = NAVIGATION_ENTRY?.type === "back_forward";

// 从详情页按浏览器后退返回时，鼠标可能仍停在触发自动跳转的卡片上。
// 重置卡片状态，并等鼠标离开后再允许悬浮跳转，避免返回后立刻再次进入详情。
window.addEventListener("pageshow", (event) => {
  // 后退/前进回来（含 bfcache 恢复）：把卡片状态清干净，并先屏蔽 hover 跳转，
  // 否则指针还停在原卡片上，几秒后会被再次带进详情页 —— 看起来就像"back 失灵"
  if (!event.persisted && !suppressHoverUntilLeave) return;
  document.querySelectorAll(".book-card").forEach((card) => card.__resetHoverTrace?.());
  suppressHoverUntilLeave = true;
});

// 指针离开所有卡片后恢复 hover 跳转（鼠标停在空白处也算"离开"）
document.addEventListener(
  "pointermove",
  (event) => {
    if (!suppressHoverUntilLeave) return;
    if (event.target.closest?.(".book-card")) return;
    suppressHoverUntilLeave = false;
  },
  { passive: true }
);

/* 卡片 / hover 结束后统一走这里进入详情页 */
const detailUrl = (book) => `book.html?id=${encodeURIComponent(book.id)}`;

/* ---------------- 数据 & 筛选 ---------------- */

function sortBooks(books) {
  return [...books].sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    const sortA = a.sort ?? 9999;
    const sortB = b.sort ?? 9999;
    return sortA - sortB;
  });
}

function buildFilters(tags) {
  const set = new Set();
  (tags || []).forEach((t) => (t || []).forEach((tag) => set.add(tag)));
  return ["全部", ...Array.from(set)];
}

/* ---------------- 描边几何 ---------------- */

// 时长只有一处定义：css/tokens.css 的 --dur-trace
function traceDuration() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-trace").trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TRACE_MS;
  return /ms$/i.test(raw) ? Math.round(value) : Math.round(value * 1000);
}

function roundedRectPath(width, height, radius, inset) {
  const n = (v) => Math.round(v * 100) / 100;
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;
  const limit = Math.min((right - left) / 2, (bottom - top) / 2);
  const r = Math.max(0, Math.min(radius, limit));

  if (r < 0.5) {
    return `M ${n(left)} ${n(top)} H ${n(right)} V ${n(bottom)} H ${n(left)} Z`;
  }

  const a = n(r);
  return [
    `M ${n(left + r)} ${n(top)}`,
    `H ${n(right - r)}`,
    `A ${a} ${a} 0 0 1 ${n(right)} ${n(top + r)}`,
    `V ${n(bottom - r)}`,
    `A ${a} ${a} 0 0 1 ${n(right - r)} ${n(bottom)}`,
    `H ${n(left + r)}`,
    `A ${a} ${a} 0 0 1 ${n(left)} ${n(bottom - r)}`,
    `V ${n(top + r)}`,
    `A ${a} ${a} 0 0 1 ${n(left + r)} ${n(top)}`,
    "Z"
  ].join(" ");
}

// 一个 ResizeObserver 管所有卡片，尺寸变化时重算路径（viewBox 与像素 1:1，不会拉伸）
const borderObserver = "ResizeObserver" in window
  ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const sync = entry.target.__syncBorder;
        if (typeof sync === "function") sync();
      }
    })
  : null;

function mountBorder(card) {
  const wrap = document.createElement("div");
  wrap.className = "book-card__border";
  wrap.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "book-card__border-svg");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");

  const track = document.createElementNS(SVG_NS, "path");
  track.setAttribute("class", "book-card__border-track");

  const stroke = document.createElementNS(SVG_NS, "path");
  stroke.setAttribute("class", "book-card__border-stroke");
  stroke.setAttribute("pathLength", "1"); // 关键：把整条路径长度归一为 1

  svg.append(track, stroke);
  wrap.append(svg);

  const sync = () => {
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    if (width < 2 || height < 2) return; // 被筛选隐藏时跳过
    const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    const boxW = width + TRACE_PAD * 2;
    const boxH = height + TRACE_PAD * 2;
    const ringInset = TRACE_PAD - RING_GAP - RING_STROKE / 2;
    // 描边中心距卡片外缘 = RING_GAP + 半个线宽
    const d = roundedRectPath(boxW, boxH, radius + RING_GAP + RING_STROKE / 2, ringInset);
    svg.setAttribute("viewBox", `0 0 ${boxW} ${boxH}`);
    track.setAttribute("d", d);
    stroke.setAttribute("d", d);
  };

  card.__syncBorder = sync;
  sync();
  if (borderObserver) borderObserver.observe(card);

  return { wrap, stroke };
}

/* ---------------- 卡片 ---------------- */

function createCard(book) {
  // 卡片直接是链接：点击 / 中键 / 键盘回车都走浏览器原生行为
  const card = document.createElement("a");
  card.className = "book-card fade-in";
  card.href = detailUrl(book);
  card.dataset.bookId = book.id;
  card.setAttribute("aria-label", book.title ? `查看《${book.title}》详情` : "查看书籍详情");

  // 「待读」统一走灰化态（有封面 / 星尘占位都算），保证同一状态看起来一致
  if (Array.isArray(book.type) && book.type.includes("待读")) {
    card.classList.add("is-inactive");
  }
  if (book.tags) card.dataset.tags = book.tags.join("|");

  // 顶部搜索用的检索串
  card.__searchText = [
    book.title,
    book.titleEn,
    book.author,
    book.pinText,
    book.meta && book.meta.publisher,
    book.meta && book.meta.publishYear,
    book.meta && book.meta.originalTitle,
    ...(book.tags || []),
    ...(book.type || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const palette = book.coverPalette || {};
  if (palette.bgTop) card.style.setProperty("--book-card-accent", palette.bgTop);
  if (palette.bgBottom) card.style.setProperty("--book-card-bg-bottom", palette.bgBottom);

  const { wrap: border, stroke } = mountBorder(card);

  /* --- 状态 --- */
  const state = {
    active: false,     // 正在绘制
    traced: false,     // 已画满，正在进入详情
    animation: null,
    timer: 0
  };

  const setOffset = (value) => {
    stroke.style.strokeDashoffset = value;
  };

  const clearTimer = () => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
  };

  // 收起描边：先淡出，等透明度归零后再复位 dashoffset，避免看到跳变
  const hideBorder = () => {
    clearTimer();
    card.classList.remove("is-tracing", "is-traced");
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      if (card.classList.contains("is-tracing") || card.classList.contains("is-traced")) return;
      if (state.animation) {
        state.animation.cancel();
        state.animation = null;
      }
      stroke.style.removeProperty("stroke-dashoffset");
    }, 260);
  };

  const completeTrace = (animation) => {
    if (state.animation !== animation || !state.active) return;
    state.active = false;
    state.traced = true;
    setOffset("0px");          // 先落到内联样式，再取消动画，边框保持 100%
    animation.cancel();
    state.animation = null;
    card.classList.remove("is-tracing");
    card.classList.add("is-traced");
    goToDetail();
  };

  const startTrace = () => {
    if (state.active || state.traced) return;
    if (!FINE_POINTER.matches) return;
    clearTimer();
    if (state.animation) {
      state.animation.cancel();
      state.animation = null;
    }
    setOffset("1px");
    card.classList.add("is-tracing");

    const animation = stroke.animate(
      [{ strokeDashoffset: "1px" }, { strokeDashoffset: "0px" }],
      { duration: traceDuration(), easing: "linear", fill: "forwards" }
    );
    state.animation = animation;
    state.active = true;
    animation.onfinish = () => completeTrace(animation);
  };

  const abortTrace = () => {
    if (!state.active) {
      if (card.classList.contains("is-tracing")) hideBorder();
      return;
    }
    state.active = false;
    hideBorder(); // 淡出后再取消动画
  };

  card.__resetHoverTrace = () => {
    clearTimer();
    if (state.animation) {
      state.animation.cancel();
      state.animation = null;
    }
    state.active = false;
    state.traced = false;
    card.__entering = false;   // bfcache 恢复后这张卡可能还留着"正在跳转"的标记
    card.classList.remove("is-tracing", "is-traced");
    stroke.style.removeProperty("stroke-dashoffset");
  };

  // hover 满一圈后进入详情：先把 hover 的样式清干净，再走和"单击"完全一样的导航路径
  const goToDetail = () => {
    if (card.__entering) return;
    card.__resetHoverTrace();   // 先清掉 hover 的样式（顺带复位 __entering）
    card.__entering = true;
    card.click();               // 和用户单击走同一条导航路径
  };

  /* --- 交互 --- */
  card.addEventListener("mouseenter", () => {
    if (suppressHoverUntilLeave) return;
    startTrace();
  });
  card.addEventListener("mouseleave", () => {
    if (suppressHoverUntilLeave) suppressHoverUntilLeave = false;
    if (state.traced) return; // 已经画满（正在跳转）就别再收回去
    abortTrace();
  });

  /* --- DOM --- */
  const inner = document.createElement("div");
  inner.className = "book-card__inner";

  const coverArea = document.createElement("div");
  coverArea.className = "book-card__cover-area";

  let pin = null;
  if (book.pinned) {
    pin = document.createElement("div");
    pin.className = "book-card__pin";
    pin.textContent = book.pinText || "推荐";
  }

  if (book.cover) {
    const coverFrame = document.createElement("div");
    coverFrame.className = "book-card__cover-frame";

    const img = document.createElement("img");
    img.className = "book-card__cover";
    img.src = book.cover;
    img.alt = book.title || "";
    img.loading = "lazy";

    coverFrame.appendChild(img);
    coverArea.appendChild(coverFrame);
  } else {
    coverArea.classList.add("book-card__cover-area--spoiler");
    // 占位框：和真实封面同宽同比例（不可见），让无封面卡片与有封面卡片一样高
    const ghostFrame = document.createElement("div");
    ghostFrame.className = "book-card__cover-frame book-card__cover-frame--ghost";
    ghostFrame.setAttribute("aria-hidden", "true");
    coverArea.appendChild(ghostFrame);
    const spoilerBlur = document.createElement("div");
    spoilerBlur.className = "book-card__spoiler-blur";
    const canvas = document.createElement("canvas");
    canvas.className = "book-card__spoiler-canvas";
    coverArea.appendChild(spoilerBlur);
    coverArea.appendChild(canvas);

    // 粒子层常驻：不再做点击消散，避免弹窗关闭后遮罩层永久消失
    initSpoiler(canvas);
  }

  const meta = document.createElement("div");
  meta.className = "book-card__meta";
  const metaHeader = document.createElement("div");
  metaHeader.className = "book-card__meta-header";
  const title = document.createElement("h2");
  title.className = "book-card__title";
  title.textContent = book.title || "";
  const titleEn = document.createElement("p");
  titleEn.className = "book-card__title-en";
  titleEn.textContent = book.titleEn || "";
  metaHeader.appendChild(title);
  if (book.titleEn) metaHeader.appendChild(titleEn);
  meta.appendChild(metaHeader);

  const metaList = document.createElement("div");
  metaList.className = "book-card__meta-list";
  const metaItems = [
    { key: "作者", value: book.author },
    { key: "出版社", value: book.meta && book.meta.publisher },
    { key: "出版年", value: book.meta && book.meta.publishYear },
    { key: "原作名", value: book.meta && book.meta.originalTitle }
  ];
  metaItems.forEach((item) => {
    if (!item.value) return;
    const row = document.createElement("div");
    row.className = "book-card__meta-item";
    const key = document.createElement("span");
    key.className = "book-card__meta-key";
    key.textContent = item.key;
    const value = document.createElement("span");
    value.className = "book-card__meta-value";
    value.textContent = item.value;
    row.appendChild(key);
    row.appendChild(value);
    metaList.appendChild(row);
  });
  if (metaList.children.length > 0) meta.appendChild(metaList);

  inner.appendChild(coverArea);
  inner.appendChild(meta);
  card.appendChild(border);
  card.appendChild(inner);
  // 角标挂在卡片上（不用 meta 里），这样「待读」灰化只作用于 inner，推荐标签保持原色
  if (pin) card.appendChild(pin);

  return card;
}

/* ---------------- 书架渲染 & 筛选 ---------------- */

const shelfState = { tag: "全部", query: "" };
let shelfCards = [];
let shelfEmpty = null;

function applyFilters() {
  const query = shelfState.query.trim().toLowerCase();
  let visible = 0;
  shelfCards.forEach((card) => {
    const tagOk =
      shelfState.tag === "全部" || (card.dataset.tags || "").split("|").includes(shelfState.tag);
    const queryOk = !query || (card.__searchText || "").includes(query);
    const hide = !(tagOk && queryOk);
    card.classList.toggle("is-hidden", hide);
    if (!hide) visible += 1;
  });
  if (shelfEmpty) shelfEmpty.hidden = visible > 0;
}

// 顶部搜索框（js/header.js）派发
window.addEventListener("books:search", (event) => {
  const detail = (event && event.detail) || {};
  shelfState.query = String(detail.query || "");
  applyFilters();
});

export async function renderShelf() {
  const grid = document.querySelector("[data-shelf]");
  const filterBar = document.querySelector("[data-filter-bar]");
  if (!grid) return;

  try {
    const data = await loadBooks();
    const books = sortBooks(data.books || []);
    const tags = buildFilters(books.map((b) => b.tags || []));

    if (filterBar) {
      filterBar.replaceChildren();
      tags.forEach((tag, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "filter-chip";
        if (idx === 0) btn.classList.add("is-active");
        btn.dataset.filter = tag;
        btn.textContent = tag;
        filterBar.appendChild(btn);
      });

      filterBar.addEventListener("click", (e) => {
        const btn = e.target.closest(".filter-chip");
        if (!btn) return;
        filterBar.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        shelfState.tag = btn.dataset.filter || "全部";
        applyFilters();
      });
    }

    shelfCards = books.map(createCard);
    shelfEmpty = document.querySelector("[data-shelf-empty]");
    grid.replaceChildren(...shelfCards);
    if (NAVIGATION_ENTRY?.type === "back_forward") {
      suppressHoverUntilLeave = Boolean(grid.querySelector(".book-card:hover"));
    }
    applyFilters();
  } catch (err) {
    console.error(err);
    grid.innerHTML = "<p style='color: var(--text-tertiary)'>暂无书籍，请先在 data/books.json 添加书籍信息。</p>";
  }
}

/* ---------------- 排列方式（横向 / 竖向） ---------------- */

const VIEW_KEY = "jianzhu-view";
const VIEW_DEFAULT = "list";

function applyShelfView(view) {
  const shelf = document.querySelector("[data-shelf]");
  if (!shelf) return;
  const next = view === "poster" ? "poster" : "list";
  shelf.dataset.view = next;
  document.querySelectorAll("[data-view-btn]").forEach((btn) => {
    const active = btn.dataset.viewBtn === next;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch (err) {
    /* 隐私模式下忽略 */
  }
}

function initShelfView() {
  let saved = null;
  try {
    saved = localStorage.getItem(VIEW_KEY);
  } catch (err) {
    saved = null;
  }
  applyShelfView(saved || VIEW_DEFAULT);
  const controls = document.querySelector("[data-view-btn]");
  if (!controls) return;
  document.querySelectorAll("[data-view-btn]").forEach((btn) => {
    btn.addEventListener("click", () => applyShelfView(btn.dataset.viewBtn));
  });
}

initShelfView();