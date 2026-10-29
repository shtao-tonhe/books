import { loadBooks } from "./data-loader.js";
import { applyCoverGlow } from "./color-extract.js";
import { initSpoiler } from "./spoiler-particles.js";
import { mountNotes, renderMarkdown } from "./markdown.js";

/* 参数优先读 query，其次读 hash：
   clean-url 类服务器会把 /book.html?id=1 301 成 /book 并丢掉 query，
   但 hash 不会丢，所以链接里把状态写在 hash 上 */
function readParam(key) {
  const fromQuery = new URLSearchParams(location.search);
  if (fromQuery.get(key)) return fromQuery.get(key);
  return new URLSearchParams(location.hash.replace(/^#/, "")).get(key);
}

function getId() {
  return readParam("id");
}

/* 从书架点进来时，卡片链接里带了书架的状态（tag / q / view / focus），
   返回书架就原样回去，筛选、搜索词、滚动位置都不丢 */
function getShelfReturn() {
  const from = readParam("from");
  if (!from) return "index.html";
  return `index.html#${from}`;
}

function applyBackLink() {
  const back = document.querySelector(".back-link");
  if (back) back.href = getShelfReturn();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/* 空状态：id 缺失 / 查不到这本书 */
function showMissing(root, message) {
  if (!root) return;
  root.innerHTML = "";
  const wrap = el("div", "detail-missing");
  wrap.appendChild(el("p", "detail-missing__title", message));
  wrap.appendChild(el("p", "detail-missing__hint", "链接可能不完整，或者这本书还没上架。"));
  const link = el("a", "detail-missing__link", "返回书架");
  link.href = getShelfReturn();
  wrap.appendChild(link);
  root.appendChild(wrap);
  document.title = "荐书 · 未找到";
}

/* 无封面（或封面加载失败）时，用和书架一致的星尘占位顶上 */
function mountCoverFallback(hero, cover, glow, book) {
  if (!hero || hero.dataset.fallback === "1") return;
  hero.dataset.fallback = "1";
  if (cover) cover.style.display = "none";
  if (glow) glow.style.display = "none";

  // 渐变直接刷在封面框上，避免多包一层导致高度算不出来
  const palette = book.coverPalette || {};
  const top = palette.bgTop || "var(--glow-1)";
  const bottom = palette.bgBottom || "var(--bg-elev)";
  hero.style.background = `radial-gradient(120% 120% at 50% 0%, ${top} 0%, ${bottom} 100%)`;

  hero.appendChild(el("div", "book-card__spoiler-blur"));
  const canvas = el("canvas", "book-card__spoiler-canvas");
  hero.appendChild(canvas);
  // 等一帧再初始化：刚 append 时尺寸还没算出来
  requestAnimationFrame(() => initSpoiler(canvas));
}

/* 详情页顶栏：书名滚出视口后，在顶栏中间补一个书名 */
function mountHeaderTitle(title) {
  const label = document.querySelector("[data-header-title]");
  const header = document.querySelector("[data-site-header]");
  const heroTitle = document.querySelector("[data-title]");
  if (!label || !header || !heroTitle || !title) return;
  label.textContent = title;

  const headerHeight = Math.round(header.getBoundingClientRect().height) || 80;
  const apply = (visible) => header.classList.toggle("is-title-visible", visible);

  if (typeof IntersectionObserver !== "function") return;
  const io = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      // 顶部留出顶栏高度：书名被顶栏挡住就算"看不见了"
      const scrolledPast = entry.boundingClientRect.top < 0;
      apply(!entry.isIntersecting && scrolledPast);
    },
    { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 }
  );
  io.observe(heroTitle);
}

/* 作者信息：支持单作者（author / author_photo / author_desc）
   也支持多作者（authors: [{ name, photo, bio }]），photo 可以是字符串或数组 */
function normalizeAuthors(book) {
  const toList = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean);
  const list = [];

  if (Array.isArray(book.authors) && book.authors.length) {
    book.authors.forEach((author) => {
      if (!author) return;
      const name = typeof author === "string" ? author : author.name || "";
      if (!name && !author.photo && !author.bio) return;
      list.push({
        name,
        photos: typeof author === "string" ? [] : toList(author.photo || author.photos),
        bio: typeof author === "string" ? "" : String(author.bio || author.desc || "")
      });
    });
  }

  if (!list.length) {
    list.push({
      name: book.author || "",
      photos: toList(book.author_photo || book.authorPhoto),
      bio: String(book.author_desc || book.authorDesc || "")
    });
  }

  return list;
}

/* 多张照片：默认叠放，点击展开成一行（展开后按容器宽度均分，不会撑破布局） */
function makePhotoStackExpandable(wrap, count) {
  wrap.classList.add("detail-hero__photos--expandable");
  wrap.style.setProperty("--photo-count", String(count));
  wrap.setAttribute("role", "button");
  wrap.setAttribute("tabindex", "0");
  wrap.setAttribute("aria-expanded", "false");
  wrap.setAttribute("aria-label", `展开作者照片（共 ${count} 张）`);

  const setOpen = (open) => {
    wrap.classList.toggle("is-expanded", open);
    wrap.setAttribute("aria-expanded", String(open));
    wrap.setAttribute("aria-label", `${open ? "收起" : "展开"}作者照片（共 ${count} 张）`);
  };

  wrap.addEventListener("click", () => setOpen(!wrap.classList.contains("is-expanded")));
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(!wrap.classList.contains("is-expanded"));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  });
  // 点空白处收起
  document.addEventListener("click", (event) => {
    if (!wrap.classList.contains("is-expanded")) return;
    if (!wrap.contains(event.target)) setOpen(false);
  });
}

/* 作者照片 + 作者简介；两者都可缺席（匿名网文就没有简介） */
function mountAuthor(book) {
  const photoWrap = document.querySelector("[data-author-photos]");
  const bio = document.querySelector("[data-author-bio]");
  const bioText = document.querySelector("[data-author-desc]");
  const authors = normalizeAuthors(book);

  // 头像：所有作者的所有照片按顺序叠放
  const photos = authors.flatMap((author) => author.photos);
  if (photoWrap) {
    photoWrap.replaceChildren();
    photos.forEach((src, index) => {
      const img = document.createElement("img");
      img.className = "detail-hero__photo";
      img.src = src;
      img.alt = `${authors.map((a) => a.name).filter(Boolean).join("、") || "作者"} 照片${
        photos.length > 1 ? ` ${index + 1}` : ""
      }`;
      img.loading = "lazy";
      img.decoding = "async";
      photoWrap.appendChild(img);
    });
    photoWrap.hidden = photos.length === 0;
    photoWrap.classList.remove("detail-hero__photos--expandable", "is-expanded");
    photoWrap.removeAttribute("role");
    photoWrap.removeAttribute("aria-expanded");
    photoWrap.removeAttribute("tabindex");
    if (photos.length > 1) makePhotoStackExpandable(photoWrap, photos.length);
  }

  // 简介：作者名（单作者时报书名下的作者名，不重复）
  const withBio = authors.filter((author) => author.bio.trim());
  if (bio && bioText) {
    bioText.replaceChildren();
    withBio.forEach((author) => {
      const block = document.createElement("div");
      block.className = "detail-hero__bio-author";
      if (withBio.length > 1 && author.name) {
        const name = document.createElement("p");
        name.className = "detail-hero__bio-name";
        name.textContent = author.name;
        block.appendChild(name);
      }
      const text = document.createElement("div");
      // 兼容手写时用 "/n" 当换行的情况
      text.innerHTML = renderMarkdown(author.bio.replace(/\/n/g, "\n\n").trim());
      block.appendChild(text);
      bioText.appendChild(block);
    });
    bio.hidden = withBio.length === 0;
  }
}

const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';

/* 源文件：放到封面右下角，有文件才出现 */
function mountDownloads(book) {
  const wrap = document.querySelector("[data-cover-downloads]");
  if (!wrap) return;
  const files = Array.isArray(book.files) ? book.files.filter((f) => f && f.path) : [];
  wrap.replaceChildren();
  wrap.hidden = files.length === 0;
  files.forEach((file) => {
    const link = el("a", "detail-cover__download");
    link.href = file.path;
    if (file.name) link.download = file.name;
    const label = `下载 ${file.name || "源文件"}`;
    link.title = label;
    link.setAttribute("aria-label", label);
    link.innerHTML = DOWNLOAD_ICON;
    wrap.appendChild(link);
  });
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
    // 没有封面的书在相关推荐里没法渲染封面，直接跳过，避免破图
    if (!book || !book.cover) return;
    const card = document.createElement("a");
    card.className = "book-card fade-in";
    card.href = `book.html?id=${encodeURIComponent(book.id)}`;
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
  if (!root) return;
  applyBackLink();
  if (!id) {
    showMissing(root, "没有指定要看的书");
    return;
  }
  try {
    const data = await loadBooks();
    const book = data.books.find((b) => b.id === id);
    if (!book) {
      showMissing(root, "没有找到这本书");
      return;
    }
    // 先把标题定下来，后面就算某块渲染失败，浏览器标签页也是对的
    document.title = `荐书 · ${book.title || ""}`;

    // Hero
    const hero = document.querySelector("[data-hero]");
    const coverWrap = hero.querySelector(".detail-hero__cover");
    const cover = hero.querySelector("[data-cover]");
    const glow = hero.querySelector("[data-cover-glow]");
    if (cover && book.cover) {
      cover.alt = book.title || "";
      cover.addEventListener("error", () => mountCoverFallback(coverWrap, cover, glow, book), { once: true });
      cover.src = book.cover;
      try {
        applyCoverGlow(cover, glow);
      } catch (err) {
        console.warn("cover glow failed", err);
      }
    } else {
      mountCoverFallback(coverWrap, cover, glow, book);
    }
    const titleEl = hero.querySelector("[data-title]");
    const titleEnEl = hero.querySelector("[data-title-en]");
    const authorEl = hero.querySelector("[data-author]");
    if (titleEl) titleEl.textContent = book.title || "";
    if (titleEnEl) titleEnEl.textContent = book.titleEn || "";
    if (authorEl) authorEl.textContent = book.author || "";
    mountHeaderTitle(book.title || "");
    const tags = hero.querySelector("[data-tags]");
    if (tags) {
      tags.innerHTML = "";
      (book.tags || []).forEach((tag) => {
        const t = el("span", "detail-tag", tag);
        tags.appendChild(t);
      });
    }

    // Intro：没有正文时给一句占位，别留一个空标题，也别把整页掏空
    const intro = document.querySelector("[data-intro]");
    const introBlock = document.querySelector("[data-intro-block]");
    if (intro) {
      intro.innerHTML = "";
      const desc = book.description || "";
      desc.split("\n\n").forEach((p) => {
        const trimmed = p.trim();
        if (!trimmed) return;
        intro.appendChild(el("p", null, trimmed));
      });
      if (!intro.children.length) {
        intro.appendChild(el("p", "is-placeholder", "这本书还没有写简介。"));
      }
      if (introBlock) introBlock.style.display = "";
    }

    // AI Summary（文字 / 核心 / 图谱 都没有时，整块隐藏）
    const summary = book.aiSummary || {};
    const summaryBlock = document.querySelector("[data-summary-block]");
    const hasSummary =
      Boolean(summary.text) ||
      (Array.isArray(summary.core) && summary.core.length > 0) ||
      Boolean(summary.graph && summary.graph.src);
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

    if (summaryBlock) summaryBlock.style.display = hasSummary ? "" : "none";

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

    mountAuthor(book);
    mountDownloads(book);

    // 读者笔记：默认约定 data/notes/<id>.md，也可以在 books.json 里用 notes 指定别的路径
    const notesBlock = document.querySelector("[data-notes-block]");
    const notesEl = document.querySelector("[data-notes]");
    if (notesBlock && notesEl) {
      const notePath = book.notes === false ? "" : book.notes || `data/notes/${id}.md`;
      const hasNotes = notePath ? await mountNotes(notesEl, notePath) : false;
      notesBlock.hidden = !hasNotes;
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

  } catch (err) {
    console.error(err);
    showMissing(root, "这本书加载失败了");
  }
}