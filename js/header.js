/**
 * 顶部栏
 *
 * 1. 固定在页面最上层，未滚动时完全透明，不遮挡大图；
 * 2. 向下滚动超过 100px 后，整条栏淡入玻璃底 + 下边线（不再依赖顶部大图的高度）；
 * 3. 搜索默认是右侧的一枚放大镜，越过阈值后滑动到中间并展开成输入框；
 * 4. 详情页只有「返回书架 + 主题切换」，复用同一套滚动逻辑。
 */

const WIDE = "(min-width: 721px)";
const CONDENSE_AT = 100; // 滚动超过这个距离就切到吸顶态（与顶部大图多高无关）
const HYSTERESIS = 24;   // 回滚时的迟滞，避免在阈值附近来回抖动

export function initHeader() {
  const header = document.querySelector("[data-site-header]");
  if (!header) return;

  const bar = header.querySelector("[data-header-bar]");
  const slot = header.querySelector("[data-search-slot]");
  const form = header.querySelector("[data-search-form]");
  const input = header.querySelector("[data-search-input]");
  const toggle = header.querySelector("[data-search-toggle]");
  const clear = header.querySelector("[data-search-clear]");
  const trail = header.querySelector("[data-header-trail]");

  let condensed = false;   // 已滚过顶部大图
  let searching = false;   // 主动展开搜索（在顶部点了放大镜）
  let frame = 0;
  let resizeFrame = 0;

  const isWide = () => window.matchMedia(WIDE).matches;

  /* ---------- 搜索的位置 ---------- */

  // 收起态要贴着右侧主题按钮，所以把「居中位置 → 靠右位置」的位移算出来交给 CSS
  function measure() {
    if (!slot || !bar || !trail) {
      header.classList.add("is-ready");
      return;
    }
    if (!isWide()) {
      header.style.removeProperty("--search-rest-x");
      header.classList.add("is-ready");
      return;
    }
    const barRect = bar.getBoundingClientRect();
    const trailRect = trail.getBoundingClientRect();
    if (!barRect.width || !trailRect.width) {
      header.classList.add("is-ready");
      return;
    }
    const styles = getComputedStyle(header);
    const gap = parseFloat(styles.getPropertyValue("--header-gap")) || 12;
    const restWidth = parseFloat(styles.getPropertyValue("--search-rest-w")) || 42;
    const x = trailRect.left - gap - restWidth / 2 - (barRect.left + barRect.width / 2);
    header.style.setProperty("--search-rest-x", `${Math.round(x)}px`);
    header.classList.add("is-ready");
  }

  /* ---------- 状态同步 ---------- */

  function syncSearch() {
    if (!slot) return;
    const open = condensed || searching;
    slot.classList.toggle("is-open", open);
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
  }

  function setSearching(value) {
    const next = Boolean(value) && !condensed;
    searching = next;
    header.classList.toggle("is-searching", next);
    syncSearch();
    if (next && input) {
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
  }

  function update() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    // 只要往下滑超过 100px 就切换，不再关心顶部大图有多高
    const next = condensed ? y > CONDENSE_AT - HYSTERESIS : y >= CONDENSE_AT;
    if (next === condensed) return;

    condensed = next;
    header.classList.toggle("is-condensed", condensed);
    searching = false;
    header.classList.remove("is-searching");
    // 已有搜索词时保持展开，避免「结果还在、输入框没了」
    if (!condensed && input && input.value.trim()) {
      searching = true;
      header.classList.add("is-searching");
    }
    syncSearch();
  }

  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  }

  /* ---------- 搜索交互 ---------- */

  if (slot && form && input) {
    const emit = (query) => {
      window.dispatchEvent(new CustomEvent("books:search", { detail: { query } }));
    };

    form.addEventListener("submit", (event) => event.preventDefault());

    if (toggle) {
      toggle.addEventListener("click", () => {
        if (condensed || searching) {
          input.focus({ preventScroll: true });
          return;
        }
        setSearching(true);
      });
    }

    // 键盘 Tab 进入隐藏的输入框时，自动展开
    input.addEventListener("focus", () => {
      if (!condensed && !searching) setSearching(true);
    });

    const syncClear = () => {
      if (clear) clear.hidden = input.value.length === 0;
    };

    input.addEventListener("input", () => {
      syncClear();
      emit(input.value);
    });

    if (clear) {
      clear.addEventListener("mousedown", (event) => event.preventDefault()); // 别把输入框弄失焦
      clear.addEventListener("click", () => {
        input.value = "";
        syncClear();
        emit("");
        input.focus({ preventScroll: true });
      });
    }

    syncClear();

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (input.value) {
        input.value = "";
        if (clear) clear.hidden = true;
        emit("");
      } else {
        input.blur();
        setSearching(false);
      }
    });

    input.addEventListener("blur", () => {
      if (!input.value.trim()) setSearching(false);
    });
  }

  /* ---------- 启动 ---------- */

  measure();
  syncSearch();
  update();

  window.addEventListener("scroll", onScroll, { passive: true });

  window.addEventListener("resize", () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      measure();
      update();
    });
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measure();
      update();
    });
  }
}