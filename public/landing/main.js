/* Intelligence Designed To Evolve — interactions
   1. Count-up stats (IntersectionObserver, once)
   2. Mobile menu (burger toggle) */

(function () {
  "use strict";

  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* ---------------- 1. Count-up stats ---------------- */
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function format(value, decimals, suffix) {
    return value.toFixed(decimals) + suffix;
  }

  function countUp(el, index) {
    const target = parseFloat(el.dataset.target);
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    const suffix = el.dataset.suffix || "";
    const duration = 1500 + index * 80;
    const startOffset = 480 + index * 90;

    if (prefersReduced) {
      el.textContent = format(target, decimals, suffix);
      return;
    }

    window.setTimeout(function () {
      let startTs = null;
      function frame(ts) {
        if (startTs === null) startTs = ts;
        const t = Math.min((ts - startTs) / duration, 1);
        const value = target * easeOutCubic(t);
        el.textContent = format(value, decimals, suffix);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          el.textContent = format(target, decimals, suffix);
        }
      }
      requestAnimationFrame(frame);
    }, startOffset);
  }

  const values = Array.prototype.slice.call(
    document.querySelectorAll(".stat-value")
  );

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const i = values.indexOf(el);
          countUp(el, i < 0 ? 0 : i);
          observer.unobserve(el);
        });
      },
      { threshold: 0.25 }
    );
    values.forEach(function (el) {
      io.observe(el);
    });
  } else {
    values.forEach(countUp);
  }

  /* ---------------- 2. Mobile menu ---------------- */
  const burger = document.querySelector(".burger");
  const overlay = document.querySelector(".menu-overlay");
  const menu = document.getElementById("mobile-menu");

  function openMenu() {
    if (!menu || !overlay) return;
    overlay.hidden = false;
    menu.hidden = false;
    document.body.classList.add("menu-open");
    if (burger) burger.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    if (!menu || !overlay) return;
    overlay.hidden = true;
    menu.hidden = true;
    document.body.classList.remove("menu-open");
    if (burger) burger.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    if (document.body.classList.contains("menu-open")) closeMenu();
    else openMenu();
  }

  if (burger) burger.addEventListener("click", toggleMenu);
  if (overlay) overlay.addEventListener("click", closeMenu);
  if (menu) {
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeMenu);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 720) closeMenu();
  });
})();
