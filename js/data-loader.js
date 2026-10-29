const DATA_URL = "data/books.json";
const TIMEOUT = 8000;

/* 单次请求：加超时，避免网络卡住时页面一直空着 */
async function fetchOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache", signal: controller.signal });
    if (!res.ok) throw new Error(`books.json ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadBooks() {
  try {
    return await fetchOnce();
  } catch (err) {
    // 一次重试：首次请求偶发卡住 / 失败时，不至于整页空白
    return await fetchOnce();
  }
}
