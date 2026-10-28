export function applyCoverGlow(img, element) {
  if (!img || !element) return;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  img.crossOrigin = "anonymous";
  const draw = () => {
    try {
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        const alpha = data[i + 3];
        if (alpha < 200) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      if (count === 0) return;
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      element.style.setProperty("--glow-1", `rgba(${r}, ${g}, ${b}, 0.18)`);
      element.style.setProperty("--glow-2", `rgba(${r}, ${g}, ${b}, 0.1)`);
    } catch (err) {
      // CORS 或跨域导致的 tainted canvas，静默跳过
    }
  };
  if (img.complete) draw();
  else img.addEventListener("load", draw, { once: true });
}
