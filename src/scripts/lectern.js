// Lectern's behaviour: "/" to search, branch pickers, unread marks, copy link, and on a document the
// rail, its scroll spy, live reload, and code and table controls.
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
  // A page prerendered on hover counts as read only once it is shown. The server keeps a copy of what
  // you read, for "changes since your last read".
  const markRead = () => {
    write("lectern:seen", { ...read("lectern:seen", {}), [bar.dataset.doc]: Number(bar.dataset.mtime) });
    navigator.sendBeacon("/read?doc=" + encodeURIComponent(bar.dataset.doc));
  };
  if (bar.dataset.doc) document.prerendering ? document.addEventListener("prerenderingchange", markRead, { once: true }) : markRead();
  for (const link of document.querySelectorAll("[data-doc]:not(.lectern-bar)")) {
    const mtime = Number(link.dataset.mtime);
    if (mtime <= since || (seen[link.dataset.doc] ?? 0) >= mtime) continue;
    // "Updated" links to the changes since you read it.
    link.insertAdjacentHTML("afterend", link.dataset.doc in seen ? '<a class="lectern-flag unread" href="' + link.href + '?diff=read">Updated</a>' : '<span class="lectern-flag unread">New</span>');
  }

  // Copy link copies the page's address; a data-copy URL copies what it serves, a Markdown document's
  // source. That goes in as a promise so Safari still counts the click once the fetch is done.
  for (const button of document.querySelectorAll("[data-copy]")) {
    const label = button.querySelector("span");
    const text = label.textContent;
    const source = button.dataset.copy;
    const fetched = () => fetch(source).then((response) => (response.ok ? response.text() : Promise.reject())).then((body) => new Blob([body], { type: "text/plain" }));
    button.addEventListener("click", async () => {
      try {
        await (source ? navigator.clipboard.write([new ClipboardItem({ "text/plain": fetched() })]) : navigator.clipboard.writeText(location.href));
        label.textContent = "Copied";
      } catch {
        label.textContent = "Copy failed";
      }
      setTimeout(() => (label.textContent = text), 1600);
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

  // A page showing changes (?diff=): Previous and Next scroll to the change above or below the middle of
  // the window. Changes that touch, like a word's removed and added parts or a run of changed lines, count once.
  for (const button of document.querySelectorAll("[data-step]")) {
    button.addEventListener("click", () => {
      // The middle of the window below the scroll padding, where scrollIntoView centres a change.
      const middle = (innerHeight + (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)) / 2;
      const boxes = [...document.querySelectorAll("main :is(.lectern-ins, .lectern-del, .line.diff):not(.lectern-key *)")].filter((change) => change.getClientRects().length).map((change) => [change, change.getBoundingClientRect()]);
      const changes = boxes.filter(([, box], i) => !i || box.top > boxes[i - 1][1].bottom + 1);
      const [next] = (button.dataset.step === "1" ? changes.find(([, box]) => box.top > middle + 1) : changes.findLast(([, box]) => box.bottom < middle - 1)) ?? [];
      next?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  // Code, after the kit has put each block in a .code box with its copy button: blocks wider than the
  // column get a wrap toggle, and blocks over 25 lines fold to 20 until opened, except where a fold
  // could hide changes (?diff=).
  // A source view (pages/source) marks the lines its #L40-L52 hash names and scrolls to them; it never folds.
  const source = document.querySelector(".lectern-source");
  if (source) {
    const mark = () => {
      const [, from, to = from] = /^#L(\d+)(?:-L(\d+))?$/.exec(location.hash) ?? [];
      for (const line of source.querySelectorAll(".line")) line.classList.toggle("lectern-marked", Number(line.id.slice(1)) >= from && Number(line.id.slice(1)) <= to);
      source.querySelector(".lectern-marked")?.scrollIntoView({ block: "center" });
    };
    addEventListener("hashchange", mark);
    mark();
  }

  for (const pre of document.querySelectorAll("main pre.shiki:not(.lectern-source pre)")) {
    const box = pre.parentElement;
    if (pre.scrollWidth > pre.clientWidth) {
      const wrap = Object.assign(document.createElement("button"), { type: "button", className: "lectern-wrap", title: "Wrap lines" });
      wrap.setAttribute("aria-label", "Wrap lines");
      wrap.setAttribute("aria-pressed", "false");
      wrap.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 4.25h10.5M2.75 8h8.5a2 2 0 0 1 0 4H8.75m1.5-1.5-1.5 1.5 1.5 1.5M2.75 11.75h3"/></svg>';
      wrap.addEventListener("click", () => wrap.setAttribute("aria-pressed", String(pre.classList.toggle("lectern-wrapped"))));
      box.append(wrap);
    }
    const lines = pre.querySelectorAll(".line").length;
    if (lines > 25 && !new URLSearchParams(location.search).has("diff")) {
      box.classList.add("lectern-folded");
      const more = Object.assign(document.createElement("button"), { type: "button", className: "lectern-button lectern-unfold", textContent: `Show all ${lines} lines` });
      more.addEventListener("click", () => {
        box.classList.remove("lectern-folded");
        more.remove();
      });
      box.after(more);
    }
  }

  // Tables: a column of numbers aligns right unless the author aligned it, a table of three or more rows
  // sorts by its header, and a table that fits the column lets its header stick (see lectern.css).
  const number = (text) => (/^[−-]?[$€£]?[\d,]*\.?\d+(?:e[+-]?\d+)?\s*(?:%|×|[a-zµ]{1,3})?$/i.test(text) ? parseFloat(text.replace("−", "-").replace(/[^\d.e-]/gi, "")) : null);
  for (const table of document.querySelectorAll("main table")) {
    const head = table.tHead?.rows[0];
    const body = table.tBodies[0];
    if (!head || !body || table.querySelector("[rowspan], [colspan]")) continue;
    const rows = [...body.rows];
    [...head.cells].forEach((th, col) => {
      const text = (row) => row.cells[col]?.textContent.trim() ?? "";
      const numeric = rows.some(text) && rows.every((row) => !text(row) || number(text(row)) !== null);
      if (numeric && !th.style.textAlign) for (const cell of [th, ...rows.map((row) => row.cells[col])]) cell?.classList.add("lectern-num");
      if (rows.length < 3) return;
      const sort = Object.assign(document.createElement("button"), { type: "button", className: "lectern-sort" });
      sort.append(...th.childNodes);
      th.append(sort);
      sort.addEventListener("click", () => {
        const order = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        for (const other of head.cells) other.removeAttribute("aria-sort");
        th.setAttribute("aria-sort", order);
        const sorted = rows.toSorted((a, b) => (numeric ? (number(text(a)) ?? -Infinity) - (number(text(b)) ?? -Infinity) : text(a).localeCompare(text(b), undefined, { numeric: true })));
        body.append(...(order === "ascending" ? sorted : sorted.reverse()));
      });
    });
    const scroller = table.parentElement;
    if (scroller.matches(".scroll, .table-wrap")) new ResizeObserver(() => scroller.classList.toggle("lectern-fits", table.scrollWidth <= scroller.clientWidth)).observe(scroller);
  }
}
