import { loadBooks } from "./data-loader.js";
import { applyCoverGlow } from "./color-extract.js";

function getId() {
  const params = new URLSearchParams(location.search);
  return params.get("id");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function renderRelated(container, books, ids) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(ids) || ids.length === 0) {
    const section = container.closest(".detail-section");
    if (section) section.style.display = "none";
    return;
  }
  ids.forEach((id) => {
    const book = books.find((b) => b.id === id);
    if (!book) return;
    const card = document.createElement("a");
    card.className = "book-card fade-in";
    card.href = `book.html?id=${book.id}`;
    const palette = book.coverPalette || {};
    if (palette.bgTop) card.style.setProperty("--book-card-accent", palette.bgTop);
    if (palette.bgBottom) card.style.setProperty("--book-card-bg-bottom", palette.bgBottom);
    const inner = document.createElement("div");
    inner.className = "book-card__inner";
    const frame = document.createElement("div");
    frame.className = "book-card__cover-frame";
    const img = document.createElement("img");
    img.className = "book-card__cover";
    img.src = book.cover;
    img.alt = book.title || "";
    frame.appendChild(img);
    const meta = document.createElement("div");
    meta.className = "book-card__meta";
    const title = document.createElement("h3");
    title.className = "book-card__title";
    title.textContent = book.title || "";
    const titleEn = document.createElement("p");
    titleEn.className = "book-card__title-en";
    titleEn.textContent = book.titleEn || "";
    const metaHeader = document.createElement("div");
    metaHeader.className = "book-card__meta-header";
    metaHeader.appendChild(title);
    if (book.titleEn) metaHeader.appendChild(titleEn);
    meta.appendChild(metaHeader);
    const coverArea = document.createElement("div");
    coverArea.className = "book-card__cover-area";
    coverArea.appendChild(frame);
    inner.appendChild(coverArea);
    inner.appendChild(meta);
    card.appendChild(inner);
    container.appendChild(card);
  });
}

export async function renderBook() {
  const id = getId();
  const root = document.querySelector("[data-book]");
  if (!root || !id) return;
  try {
    const data = await loadBooks();
    const book = data.books.find((b) => b.id === id);
    if (!book) {
      root.innerHTML = "<p style='color: var(--text-tertiary)'>未找到这本书，<a href='index.html'>返回书架</a></p>";
      return;
    }

    // Hero
    const hero = document.querySelector("[data-hero]");
    const cover = hero.querySelector("[data-cover]");
    const glow = hero.querySelector("[data-cover-glow]");
    if (cover) {
      cover.src = book.cover;
      cover.alt = book.title || "";
      applyCoverGlow(cover, glow);
    }
    const titleEl = hero.querySelector("[data-title]");
    const titleEnEl = hero.querySelector("[data-title-en]");
    const authorEl = hero.querySelector("[data-author]");
    if (titleEl) titleEl.textContent = book.title || "";
    if (titleEnEl) titleEnEl.textContent = book.titleEn || "";
    if (authorEl) authorEl.textContent = book.author || "";
    const tags = hero.querySelector("[data-tags]");
    if (tags) {
      tags.innerHTML = "";
      (book.tags || []).forEach((tag) => {
        const t = el("span", "detail-tag", tag);
        tags.appendChild(t);
      });
    }

    // Intro
    const intro = document.querySelector("[data-intro]");
    if (intro) {
      intro.innerHTML = "";
      const desc = book.description || "";
      desc.split("\n\n").forEach((p) => {
        const trimmed = p.trim();
        if (!trimmed) return;
        intro.appendChild(el("p", null, trimmed));
      });
    }

    // AI Summary
    const summary = book.aiSummary || {};
    const sumTextBlock = document.querySelector("[data-sum-text-block]");
    const sumText = document.querySelector("[data-sum-text]");
    if (sumText && sumTextBlock) {
      sumText.innerHTML = "";
      if (summary.text) {
        summary.text.split("\n\n").forEach((p) => {
          const trimmed = p.trim();
          if (!trimmed) return;
          sumText.appendChild(el("p", null, trimmed));
        });
        sumTextBlock.style.display = "flex";
      } else {
        sumTextBlock.style.display = "none";
      }
    }

    const sumCoreBlock = document.querySelector("[data-sum-core-block]");
    const sumCore = document.querySelector("[data-sum-core]");
    if (sumCore && sumCoreBlock) {
      sumCore.innerHTML = "";
      if (Array.isArray(summary.core) && summary.core.length) {
        summary.core.forEach((item) => {
          const li = el("li", "detail-list__item", item);
          sumCore.appendChild(li);
        });
        sumCoreBlock.style.display = "flex";
      } else {
        sumCoreBlock.style.display = "none";
      }
    }

    const sumGraphBlock = document.querySelector("[data-sum-graph-block]");
    const sumGraph = document.querySelector("[data-sum-graph]");
    if (sumGraph && sumGraphBlock) {
      sumGraph.innerHTML = "";
      if (summary.graph && summary.graph.type === "image" && summary.graph.src) {
        const img = el("img", "detail-graph__img");
        img.src = summary.graph.src;
        img.alt = summary.graph.alt || "AI 汇总图谱";
        sumGraph.appendChild(img);
        if (summary.graph.caption) {
          sumGraph.appendChild(el("p", "detail-graph__caption", summary.graph.caption));
        }
        sumGraphBlock.style.display = "flex";
      } else {
        sumGraphBlock.style.display = "none";
      }
    }

    // Quotes
    const quotesBlock = document.querySelector("[data-quotes-block]");
    const quotes = document.querySelector("[data-quotes]");
    if (quotes && quotesBlock) {
      quotes.innerHTML = "";
      if (Array.isArray(book.quotes) && book.quotes.length) {
        book.quotes.forEach((q) => {
          if (!q || !q.text) return;
          const wrap = el("article", "detail-quote");
          const text = el("p", "detail-quote__text", `“${q.text}”`);
          wrap.appendChild(text);
          if (q.note) wrap.appendChild(el("p", "detail-quote__note", q.note));
          quotes.appendChild(wrap);
        });
        quotesBlock.style.display = "flex";
      } else {
        quotesBlock.style.display = "none";
      }
    }

    // Extra reading
    const extraBlock = document.querySelector("[data-extra-block]");
    const extra = document.querySelector("[data-extra]");
    if (extra && extraBlock) {
      extra.innerHTML = "";
      if (Array.isArray(book.extraReading) && book.extraReading.length) {
        book.extraReading.forEach((item) => {
          if (!item || !item.url) return;
          const a = el("a", "detail-link");
          a.href = item.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.innerHTML = `<span>${item.title || item.url}</span><span>↗</span>`;
          extra.appendChild(a);
        });
        extraBlock.style.display = "flex";
      } else {
        extraBlock.style.display = "none";
      }
    }

    // Related
    const related = document.querySelector("[data-related]");
    const relatedSection = related ? related.closest(".detail-section") : null;
    renderRelated(related, data.books, book.related);
    if (related && relatedSection && related.children.length === 0) {
      relatedSection.style.display = "none";
    }

    // Files
    const fileWrap = document.querySelector("[data-file]");
    if (fileWrap) {
      fileWrap.innerHTML = "";
      if (Array.isArray(book.files) && book.files.length) {
        book.files.forEach((f) => {
          if (!f || !f.path) return;
          const a = el("a", "detail-file");
          a.href = f.path;
          if (f.name) a.download = f.name;
          a.innerHTML = `<span>${f.name || "下载原书"}</span><span>↓</span>`;
          fileWrap.appendChild(a);
        });
      } else {
        const miss = el("span", "detail-file is-missing", "源文件：暂缺");
        fileWrap.appendChild(miss);
      }
    }

    document.title = `荐书 · ${book.title || ""}`;
  } catch (err) {
    console.error(err);
    root.innerHTML = "<p style='color: var(--text-tertiary)'>加载失败，请检查 data/books.json 格式。</p>";
  }
}
