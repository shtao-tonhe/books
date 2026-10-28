/**
 * 待读卡片 / 弹窗占位图上的"星尘"粒子层。
 *
 * 只负责静态氛围与缓慢漂移：粒子一直存在，不再做点击消散（消散会把遮罩层永久移除）。
 * 通过 IntersectionObserver 在不可见时暂停 rAF，避免一堆离屏卡片空转。
 */
export function initSpoiler(canvas, options = {}) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const dpr = window.devicePixelRatio || 1;

  let width = 0;
  let height = 0;
  let particles = [];
  let rafId = 0;
  let running = false;

  const density = options.density || 720;
  const minCount = options.min || 280;
  const minR = options.minR || 0.5;
  const maxR = options.maxR || 1.8;
  const drift = options.drift || 0.22;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function resize() {
    const parent = canvas.parentElement || canvas;
    // 用布局尺寸而不是 getBoundingClientRect：弹窗开场有 scale 动画，rect 会偏小导致画布被拉伸
    width = Math.max(1, Math.floor(parent.clientWidth || 0));
    height = Math.max(1, Math.floor(parent.clientHeight || 0));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    generate();
    drawFrame(performance.now() * 0.001);
  }

  function generate() {
    particles = [];
    const area = width * height;
    const count = Math.min(density, Math.max(minCount, Math.floor(area / 720)));
    for (let i = 0; i < count; i++) {
      const baseAlpha = Math.random() * 0.5 + 0.44;
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * (maxR - minR) + minR,
        baseAlpha,
        alpha: baseAlpha,
        vx: (Math.random() - 0.5) * drift,
        vy: (Math.random() - 0.5) * drift,
        ax: (Math.random() - 0.5) * 0.01,
        ay: (Math.random() - 0.5) * 0.01,
        phase: Math.random() * Math.PI * 2,
        pulse: Math.random() * 0.16 + 0.92
      });
    }
  }

  function drawFrame(time) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.vx += p.ax;
      p.vy += p.ay;
      p.vx = Math.max(-drift * 1.8, Math.min(drift * 1.8, p.vx));
      p.vy = Math.max(-drift * 1.8, Math.min(drift * 1.8, p.vy));
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      const pulse = p.pulse + Math.sin(time + p.phase) * 0.2;
      const alpha = Math.min(1, p.baseAlpha * pulse);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(248, 245, 238, ${alpha})`;
      ctx.fill();
    }
  }

  function tick() {
    rafId = running ? requestAnimationFrame(tick) : 0;
    drawFrame(performance.now() * 0.001);
  }

  function start() {
    if (running) return;
    if (reduceMotion.matches) {
      // 减少动效：只保留静态星点，不跑 rAF
      drawFrame(0);
      return;
    }
    running = true;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement || canvas);
  resize();

  // 不可见（离屏 / 弹窗关闭）时停掉动画
  let io = null;
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry.isIntersecting && entry.intersectionRatio > 0) start();
        else stop();
      },
      { threshold: 0.01 }
    );
    io.observe(canvas);
  } else {
    start();
  }

  return {
    start,
    stop,
    destroy() {
      stop();
      ro.disconnect();
      if (io) io.disconnect();
    }
  };
}