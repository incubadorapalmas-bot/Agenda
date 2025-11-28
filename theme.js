// theme.js - alternância de modo claro/escuro com persistência em localStorage

(function () {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggle");

  const saved = localStorage.getItem("agenda_theme");
  if (saved === "dark" || saved === "light") {
    root.setAttribute("data-theme", saved);
  }

  updateIcon();

  btn.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    localStorage.setItem("agenda_theme", next);
    updateIcon();
  });

  function updateIcon() {
    const current = root.getAttribute("data-theme") || "light";
    btn.textContent = current === "light" ? "🌙" : "☀️";
  }
})();
