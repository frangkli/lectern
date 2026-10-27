// The saved theme, set before the page first paints so a page never flashes the system's theme.
try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
