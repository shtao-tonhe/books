/**
 * 读者笔记：把 data/notes/<id>.md 渲染到详情页。
 *
 * - Markdown 由本地 vendor 的 marked 解析（不依赖外网，离线也能读笔记）
 * - ```mermaid 代码块在浏览器里懒加载 mermaid 渲染成图谱；
 *   加载 / 渲染失败或超时时，保留源码，不至于开天窗
 */
import { marked } from "./vendor/marked.esm.js";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(text) {
  return marked.parse(String(text || ""));
}

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
const MERMAID_TIMEOUT = 20000; // 首次要从 CDN 拉 ~1MB，冷启动实测 4-7s

let mermaidPromise = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import(/* @vite-ignore */ MERMAID_CDN)
      .then((mod) => {
        const mermaid = mod.default || mod;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "neutral",
          fontFamily: "Georgia, 'Noto Serif SC', serif",
          themeVariables: { background: "transparent" }
        });
        return mermaid;
      })
      .catch((err) => {
        mermaidPromise = null;
        throw err;
      });
  }
  return mermaidPromise;
}

/* ---------- 图谱全屏 ---------- */

let overlay = null;
let lastFocused = null;

function ensureOverlay() {
  if (overlay && overlay.isConnected) return overlay;
  overlay = document.createElement("div");
  overlay.className = "notes-lightbox";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "图谱全屏");
  overlay.innerHTML = [
    '<button class="notes-lightbox__close" type="button" aria-label="关闭">',
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    "</button>",
    '<div class="notes-lightbox__inner"></div>'
  ].join("");

  const close = () => closeOverlay();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".notes-lightbox__close")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay && !overlay.hidden) close();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function openOverlay(source) {
  const node = ensureOverlay();
  const inner = node.querySelector(".notes-lightbox__inner");
  inner.replaceChildren();

  // 只搬 SVG 本体：mermaid 的 svg 带 width="100%" 和 max-width 内联样式，
  // 直接克隆会算成 0 宽；这里按 viewBox 重新给 100% 尺寸，靠 preserveAspectRatio 自适应铺满
  const svg = source.querySelector("svg");
  if (svg) {
    const clone = svg.cloneNode(true);
    clone.removeAttribute("style");
    clone.setAttribute("width", "100%");
    clone.setAttribute("height", "100%");
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const holder = document.createElement("div");
    holder.className = "notes-lightbox__diagram";
    holder.appendChild(clone);
    inner.appendChild(holder);
  } else {
    inner.appendChild(source.cloneNode(true));
  }

  node.hidden = false;
  requestAnimationFrame(() => node.classList.add("is-open"));
  document.body.classList.add("is-lightbox-open");
  lastFocused = document.activeElement;
  node.querySelector(".notes-lightbox__close").focus();
}

function closeOverlay() {
  if (!overlay || overlay.hidden) return;
  overlay.classList.remove("is-open");
  document.body.classList.remove("is-lightbox-open");
  window.setTimeout(() => {
    overlay.hidden = true;
    overlay.querySelector(".notes-lightbox__inner").replaceChildren();
  }, 220);
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  lastFocused = null;
}

/* 让每张渲染好的图谱可点击放大 */
function makeZoomable(box) {
  box.tabIndex = 0;
  box.setAttribute("role", "button");
  box.setAttribute("aria-label", "全屏查看图谱");
  box.addEventListener("click", () => openOverlay(box));
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openOverlay(box);
    }
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("mermaid timeout")), ms))
  ]);
}

/* 把 <pre><code class="language-mermaid"> 渲染成图谱；失败就保留源码 */
export async function renderDiagrams(container) {
  if (!container) return;
  const blocks = Array.from(container.querySelectorAll("code.language-mermaid"));
  if (!blocks.length) return;

  let mermaid = null;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    console.warn("[notes] mermaid 加载失败，保留源码", err);
    return;
  }

  let index = 0;
  for (const code of blocks) {
    const source = code.textContent || "";
    const pre = code.closest("pre") || code;
    try {
      const id = `notes-diagram-${Date.now()}-${index++}`;
      const result = await withTimeout(mermaid.render(id, source), MERMAID_TIMEOUT);
      const svg = typeof result === "string" ? result : result && result.svg;
      if (!svg) throw new Error("empty svg");
      const box = document.createElement("div");
      box.className = "notes-diagram";
      box.innerHTML = svg;
      makeZoomable(box);
      pre.replaceWith(box);
    } catch (err) {
      console.warn("[notes] 图谱渲染失败，保留源码", err);
      pre.classList.add("notes-diagram-source");
    }
  }
}

/* 拉取并渲染某本书的笔记；没有笔记返回 false */
export async function mountNotes(container, notePath) {
  if (!container || !notePath) return false;
  let res;
  try {
    res = await fetch(notePath, { cache: "no-cache" });
  } catch (err) {
    return false;
  }
  if (!res.ok) return false;
  const text = await res.text();
  if (!text.trim()) return false;
  container.innerHTML = renderMarkdown(text);
  // 图谱异步渲染，不阻塞笔记出现（容器若是 display:none，mermaid 会算不出尺寸）
  renderDiagrams(container).catch(() => {});
  return true;
}