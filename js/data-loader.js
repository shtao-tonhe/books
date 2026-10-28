export async function loadBooks() {
  const res = await fetch("data/books.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load books.json");
  return res.json();
}
