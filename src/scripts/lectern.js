// Lectern's behaviour: "/" to search, branch pickers, unread marks, copy link, and on a document the
// rail, its scroll spy and live reload.
{
  const bar = document.querySelector(".lectern-bar");
  addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.target.closest("input, select, textarea, [contenteditable]")) return;
    const field = document.querySelector(".lectern-search-lg input, .lectern-bar input[type=search]");
    if (!field) return;
    event.preventDefault();
    field.focus();
    field.select();
  });
  // Menus close on a click outside them, or on Escape.
  for (const menu of document.querySelectorAll(".lectern-menu")) {
    addEventListener("click", (event) => menu.contains(event.target) || (menu.open = false));
    menu.addEventListener("keydown", (event) => event.key === "Escape" && ((menu.open = false), menu.querySelector("summary").focus()));
  }

  // Unread: new, or updated since you last opened it, counting from your first visit to Lectern.
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  let since = read("lectern:since", 0);
  if (!since) write("lectern:since", (since = Date.now()));
  const seen = read("lectern:seen", {});
  // A page prerendered on hover counts as read only once it is shown.
  const markRead = () => write("lectern:seen", { ...read("lectern:seen", {}), [bar.dataset.doc]: Number(bar.dataset.mtime) });
  if (bar.dataset.doc) document.prerendering ? document.addEventListener("prerenderingchange", markRead, { once: true }) : markRead();
  for (const link of document.querySelectorAll("[data-doc]:not(.lectern-bar)")) {
    const mtime = Number(link.dataset.mtime);
    if (mtime <= since || (seen[link.dataset.doc] ?? 0) >= mtime) continue;
    link.insertAdjacentHTML("afterend", '<span class="lectern-flag unread">' + (link.dataset.doc in seen ? "Updated" : "New") + "</span>");
  }

  for (const button of document.querySelectorAll("[data-copy]")) {
    const label = button.querySelector("span");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        label.textContent = "Copied";
      } catch {
        label.textContent = "Copy failed";
      }
      setTimeout(() => (label.textContent = "Copy link"), 1600);
    });
  }

  const rail = document.querySelector(".lectern-rail");
  if (rail) {
    // The rail sits beside the page on wide screens, and is a drawer from the menu button on narrow ones.
    const wide = matchMedia("(min-width: 1200px)");
    wide.addEventListener("change", () => wide.matches && rail.matches(":popover-open") && rail.hidePopover());
    const links = [...rail.querySelectorAll(".lectern-toc a")];
    const targets = links.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))));
    // With three or more sections, each subsection belongs to the section above it and folds away
    // until that section is in view. section[i] is the section of subsection i.
    const items = links.map((link) => link.parentElement);
    const fold = items.filter((item) => item.classList.contains("h2")).length >= 3;
    const section = {};
    items.forEach((item, i, all) => {
      if (item.classList.contains("h3")) section[i] = all.findLastIndex((other, j) => j < i && other.classList.contains("h2"));
    });
    let queued = 0;
    const spy = () => {
      queued = 0;
      let active = -1;
      targets.forEach((target, i) => {
        if (target && target.getBoundingClientRect().top < 120) active = i;
      });
      links.forEach((link, i) => (i === active ? link.setAttribute("aria-current", "location") : link.removeAttribute("aria-current")));
      const open = section[active] ?? active;
      if (fold) items.forEach((item, i) => (item.hidden = i in section && section[i] !== open));
    };
    addEventListener("scroll", () => (queued ||= requestAnimationFrame(spy)), { passive: true });
    spy();
    // Subsections ease open and shut from here on; the first fold above happens before anything moves.
    requestAnimationFrame(() => rail.querySelector(".lectern-toc")?.setAttribute("data-ready", ""));
    for (const link of links) link.addEventListener("click", () => wide.matches || rail.hidePopover());
    // Live reload: the server sends an event when the file changes on disk.
    new EventSource("/events?doc=" + encodeURIComponent(bar.dataset.doc)).onmessage = () => location.reload();
  }
}
