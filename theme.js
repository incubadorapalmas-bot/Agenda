// theme.js - modo claro/escuro usando data-theme no <html>

document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggle");

  if (!btn) return;

  const saved = window.localStorage.getItem("agenda-theme");
  if (saved === "dark" || saved === "light") {
    root.setAttribute("data-theme", saved);
    btn.textContent = saved === "dark" ? "☀️" : "🌙";
  }

  btn.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    window.localStorage.setItem("agenda-theme", next);
    btn.textContent = next === "dark" ? "☀️" : "🌙";
  });
});
