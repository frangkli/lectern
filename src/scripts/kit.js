
      for (const tabs of document.querySelectorAll(".tabs")) {
        const panels = [...tabs.querySelectorAll(":scope > section[data-tab]")];
        const list = document.createElement("div");
        list.setAttribute("role", "tablist");
        const select = (index) =>
          panels.forEach((panel, i) => {
            panel.hidden = i !== index;
            list.children[i].setAttribute("aria-selected", String(i === index));
            list.children[i].tabIndex = i === index ? 0 : -1;
          });
        panels.forEach((panel, i) => {
          const tab = Object.assign(document.createElement("button"), { type: "button", textContent: panel.dataset.tab });
          tab.setAttribute("role", "tab");
          tab.addEventListener("click", () => select(i));
          panel.setAttribute("role", "tabpanel");
          list.append(tab);
        });
        list.addEventListener("keydown", (event) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
          if (!step) return;
          const next = (panels.findIndex((panel) => !panel.hidden) + step + panels.length) % panels.length;
          select(next);
          list.children[next].focus();
        });
        tabs.prepend(list);
        tabs.classList.add("ready");
        select(0);
      }

      // Theme: system, light or dark, saved in this browser. Lectern runs this same code and
      // sets the theme of the document in its frame; a document opened on its own gets the control.
      {
        const root = document.documentElement;
        // A page in a frame drops its own kind and date line; Lectern marks its pages with data-lectern instead.
        if (window !== top) root.dataset.framed = "";
        const saved = () => {
          try {
            return localStorage.getItem("theme") || "system";
          } catch {
            return "system";
          }
        };
        const apply = (target, theme) => (theme === "system" ? delete target.dataset.theme : (target.dataset.theme = theme));
        const frames = () => [...document.querySelectorAll("iframe")].map((frame) => frame.contentDocument?.documentElement).filter(Boolean);
        apply(root, saved());
        for (const frame of document.querySelectorAll("iframe")) {
          frame.addEventListener("load", () => frame.contentDocument && apply(frame.contentDocument.documentElement, saved()));
        }
        if (window === top) {
          const icons = {
            system: '<rect x="2" y="3" width="12" height="8.5" rx="1.5"/><path d="M6 14h4M8 11.5V14"/>',
            light: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05"/>',
            dark: '<path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z"/>',
          };
          const group = Object.assign(document.createElement("div"), { className: "theme" });
          group.setAttribute("role", "group");
          group.setAttribute("aria-label", "Theme");
          const buttons = Object.keys(icons).map((theme) => {
            const button = Object.assign(document.createElement("button"), { type: "button", title: `${theme[0].toUpperCase()}${theme.slice(1)} theme` });
            button.setAttribute("aria-label", button.title);
            button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${icons[theme]}</svg>`;
            button.addEventListener("click", () => {
              try {
                localStorage.setItem("theme", theme);
              } catch {}
              for (const target of [root, ...frames()]) apply(target, theme);
              buttons.forEach((other, i) => other.setAttribute("aria-pressed", String(Object.keys(icons)[i] === theme)));
            });
            button.setAttribute("aria-pressed", String(theme === saved()));
            return button;
          });
          group.append(...buttons);
          (document.querySelector("[data-theme-control]") ?? document.querySelector("main") ?? document.body).prepend(group);
        }
      }

      // A link beside every section heading, and a copy button on every code block.
      for (const heading of document.querySelectorAll("main :is(h2, h3)[id]")) {
        const link = Object.assign(document.createElement("a"), { className: "anchor", href: `#${heading.id}` });
        link.setAttribute("aria-label", `Link to “${heading.textContent.trim()}”`);
        heading.append(link);
      }
      for (const pre of document.querySelectorAll("main pre:not(.mermaid)")) {
        const wrap = Object.assign(document.createElement("div"), { className: "code" });
        const icons = {
          copy: '<rect x="5.25" y="5.25" width="8" height="8" rx="1.5"/><path d="M10.75 5.25v-1a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5h1"/>',
          done: '<path d="M3.5 8.5l3 3 6-7"/>',
        };
        const button = Object.assign(document.createElement("button"), { type: "button", className: "copy", title: "Copy code" });
        const show = (name, label) => {
          button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${icons[name]}</svg>`;
          button.setAttribute("aria-label", label);
        };
        show("copy", "Copy code");
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(pre.innerText);
            show("done", "Copied");
            button.dataset.copied = "";
          } catch {
            button.title = "Select the code and copy it";
          }
          setTimeout(() => {
            show("copy", "Copy code");
            delete button.dataset.copied;
          }, 1600);
        });
        pre.replaceWith(wrap);
        wrap.append(pre, button);
      }

      // Highlighting, loaded only when a code block names a language highlight.js knows.
      {
        const blocks = [...document.querySelectorAll('main pre:not(.mermaid) > code[class*="language-"]')];
        if (blocks.length) {
          const script = Object.assign(document.createElement("script"), {
            src: "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js",
            integrity: "sha384-wjfDDhOPPdjtva8vWBhWeVprSpmxisEu5aYT3q1JyACqXpdKpo3PWZTMVq24MBix",
            crossOrigin: "anonymous",
            referrerPolicy: "no-referrer",
          });
          script.addEventListener("load", () => {
            for (const code of blocks) {
              const language = /language-([\w+-]+)/.exec(code.className)[1];
              if (hljs.getLanguage(language)) hljs.highlightElement(code);
            }
          });
          document.head.append(script);
        }
      }

      // Mermaid, loaded only when the page has a diagram. Without it the source stays readable as code.
      // Diagrams draw at their natural size in the kit's font and colours, with edge labels wrapped so
      // long ones don't stretch the drawing; one that would shrink below 80% to fit scrolls sideways.
      // On a phone, left-to-right flowcharts, subgraphs and state diagrams turn top to bottom. A
      // diagram that fails to render shows its source and the error instead.
      {
        const blocks = [...document.querySelectorAll("pre.mermaid")];
        const sources = blocks.map((block) => block.textContent);
        const probe = document.createElement("span");
        const pixel = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
        // Mermaid's colour maths and its comma-separated palettes need plain hex, so kit colours (some
        // are color-mix) go through a canvas pixel.
        const color = (value) => {
          probe.style.color = value.startsWith("--") ? `var(${value})` : value;
          pixel.clearRect(0, 0, 1, 1);
          pixel.fillStyle = getComputedStyle(probe).color;
          pixel.fillRect(0, 0, 1, 1);
          const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
          return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        };
        const soft = (name, share) => color(`color-mix(in oklab, var(${name}) ${share}%, var(--surface))`);
        const layout = { curve: "basis", wrappingWidth: 130, minNodeWidth: 0, padding: 10, nodeSpacing: 22, rankSpacing: 32, diagramPadding: 4 };
        let narrow;
        const source = (i) =>
          narrow ? sources[i].replace(/^(\s*(?:flowchart|graph)\s+)LR\b/m, "$1TB").replace(/^(\s*direction\s+)LR\b/gm, "$1TB") : sources[i];
        const fit = () => {
          if (narrow !== undefined && narrow !== innerWidth < 600) return render();
          for (const block of blocks) {
            const svg = block.querySelector("svg");
            const natural = Number.parseFloat(svg?.style.width) || svg?.viewBox.baseVal?.width;
            if (natural) block.classList.toggle("wide", natural * 0.8 > block.clientWidth);
          }
        };
        // Sankey has no palette setting, only colours per node name, so name every node from the sources.
        const sankeyColors = (palette) => {
          const names = new Set();
          for (const text of sources.filter((text) => /^\s*sankey/.test(text))) {
            for (const line of text.trim().split("\n").slice(1)) {
              const cells = line.match(/("(?:[^"]|"")*"|[^,]*),("(?:[^"]|"")*"|[^,]*),/);
              cells?.slice(1, 3).forEach((cell) => names.add(cell.trim().replace(/^"|"$/g, "").replaceAll('""', '"')));
            }
          }
          return Object.fromEntries([...names].filter(Boolean).map((name, i) => [name, palette[i % palette.length]]));
        };
        const config = (width) => {
          const background = color("--bg");
          const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(background.slice(at, at + 2), 16));
          const [text, muted, surface, sunken, border, soft2] = ["--text", "--muted", "--surface", "--sunken", "--border", "--border-soft"].map(color);
          // Node outlines sit a step darker than the page's hairlines, so shapes hold their edge.
          const line = soft("--ink", 30);
          const palette = [1, 2, 3, 4, 5, 6].map((n) => color(`--cat-${n}`));
          const tints = [1, 2, 3, 4, 5, 6].map((n) => soft(`--cat-${n}`, 22));
          const fontFamily = getComputedStyle(document.body).fontFamily;
          const themeVariables = {
            darkMode: red * 0.299 + green * 0.587 + blue * 0.114 < 128,
            background, fontFamily, fontSize: "14px", radius: 8, strokeWidth: 1, dropShadow: "none",
            primaryColor: surface, mainBkg: surface, nodeBkg: surface, primaryBorderColor: line, nodeBorder: line,
            primaryTextColor: text, nodeTextColor: text, textColor: text, titleColor: muted,
            secondaryColor: sunken, tertiaryColor: sunken, clusterBkg: "transparent", clusterBorder: border,
            lineColor: muted, arrowheadColor: muted, edgeLabelBackground: background,
            noteBkgColor: soft("--warn", 10), noteBorderColor: color("--warn"), noteTextColor: text,
            errorBkgColor: soft("--bad", 10), errorTextColor: color("--bad"),
            // Sequence diagrams.
            actorBkg: surface, actorBorder: border, actorTextColor: text, actorLineColor: border, signalColor: muted, signalTextColor: text,
            labelBoxBkgColor: surface, labelBoxBorderColor: border, labelTextColor: text, loopTextColor: text,
            activationBkgColor: sunken, activationBorderColor: border, sequenceNumberColor: background,
            // Pie, timeline and sankey take the categorical palette.
            ...Object.fromEntries(palette.flatMap((hue, i) => [[`pie${i + 1}`, soft(`--cat-${i + 1}`, 45)], [`pie${i + 7}`, hue]])),
            pieStrokeColor: surface, pieStrokeWidth: "2px", pieOuterStrokeColor: border, pieOuterStrokeWidth: "1px", pieOpacity: "1",
            pieSectionTextColor: text, pieTitleTextColor: text, pieLegendTextColor: text,
            // Text sizes allow for the pie being drawn at 0.65 scale (see pieScale).
            pieTitleTextSize: "22px", pieSectionTextSize: "20px", pieLegendTextSize: "20px",
            ...Object.fromEntries(
              tints.flatMap((tint, i) =>
                [i, i + 6].flatMap((n) => [[`cScale${n}`, tint], [`cScaleLabel${n}`, text], [`cScalePeer${n}`, palette[i]], [`cScaleInv${n}`, palette[i]]]),
              ),
            ),
            // Gantt: neutral bars, ochre today line, red critical tasks.
            gridColor: soft2, sectionBkgColor: background, altSectionBkgColor: surface, sectionBkgColor2: background,
            taskBkgColor: sunken, taskBorderColor: border, activeTaskBkgColor: soft("--cat-1", 22), activeTaskBorderColor: color("--cat-1"),
            doneTaskBkgColor: surface, doneTaskBorderColor: border, critBkgColor: soft("--bad", 14), critBorderColor: color("--bad"),
            todayLineColor: color("--warn"), vertLineColor: muted, excludeBkgColor: sunken,
            taskTextColor: text, taskTextLightColor: text, taskTextDarkColor: text, taskTextOutsideColor: text, taskTextClickableColor: color("--accent"),
            // Quadrant chart.
            quadrant1Fill: surface, quadrant2Fill: sunken, quadrant3Fill: surface, quadrant4Fill: sunken,
            quadrant1TextFill: muted, quadrant2TextFill: muted, quadrant3TextFill: muted, quadrant4TextFill: muted,
            quadrantPointFill: text, quadrantPointTextFill: text, quadrantXAxisTextFill: muted, quadrantYAxisTextFill: muted,
            quadrantInternalBorderStrokeFill: border, quadrantExternalBorderStrokeFill: border, quadrantTitleFill: text,
            // xychart: grey first, like the kit's bars, then the palette; axes in the border and muted colours.
            xyChart: {
              backgroundColor: "transparent", titleColor: text, dataLabelColor: text, legendTextColor: text,
              xAxisTitleColor: muted, xAxisLabelColor: muted, xAxisTickColor: border, xAxisLineColor: border,
              yAxisTitleColor: muted, yAxisLabelColor: muted, yAxisTickColor: border, yAxisLineColor: border,
              plotColorPalette: [muted, ...palette].join(","),
            },
          };
          const natural = { useMaxWidth: false, theme: "base", look: "classic" };
          const axis = { labelFontSize: 12.5, titleFontSize: 13.5 };
          return {
            startOnLoad: false, theme: "base", look: "classic", layout: "dagre", themeVariables,
            themeCSS: ".edgeLabel .labelBkg { max-width: 96px !important; white-space: normal !important; line-height: 1.35 !important; }",
            flowchart: { ...natural, ...layout }, state: { ...natural, ...layout },
            sequence: { ...natural, actorFontSize: 13.5, messageFontSize: 13.5, noteFontSize: 13.5, actorMargin: 40, boxMargin: 8, mirrorActors: false },
            class: natural, er: { ...natural, fontSize: 13.5 }, timeline: natural, pie: natural, quadrantChart: natural, journey: natural, mindmap: natural,
            gantt: { ...natural, useWidth: Math.max(width, 560), fontSize: 12.5, sectionFontSize: 13, barHeight: 22, barGap: 6, topPadding: 44, leftPadding: 120 },
            xyChart: { ...natural, width: Math.min(Math.max(width, 480), 720), height: 240, titleFontSize: 14, legendFontSize: 12.5, xAxis: axis, yAxis: axis },
            sankey: { ...natural, width: Math.min(Math.max(width, 480), 880), height: 360, linkColor: "source", nodeColors: sankeyColors(palette) },
          };
        };
        const pieScale = 0.65;
        let pass = 0;
        const render = async () => {
          narrow = innerWidth < 600;
          const run = ++pass;
          document.body.append(probe);
          for (const [i, block] of blocks.entries()) {
            const id = `kit-diagram-${run}-${i}`;
            block.removeAttribute("data-processed");
            block.classList.remove("wide", "failed");
            try {
              mermaid.initialize(config(block.clientWidth));
              await mermaid.parse(source(i));
              // Drawn inside the block, so labels are measured in the type they'll show in (a <pre> resets letter-spacing).
              const { svg, bindFunctions } = await mermaid.render(id, source(i), block);
              if (run !== pass) return;
              block.innerHTML = svg;
              bindFunctions?.(block);
              // Mermaid draws every pie at a fixed 370 px across; show it at about 240 px.
              const drawn = block.querySelector("svg");
              if (drawn?.getAttribute("aria-roledescription") === "pie") drawn.style.width = `${Math.round(drawn.viewBox.baseVal.width * pieScale)}px`;
              block.setAttribute("data-processed", "true");
            } catch (error) {
              for (const leftover of document.querySelectorAll(`#${id}, #d${id}`)) leftover.remove();
              block.textContent = sources[i];
              block.classList.add("failed");
              block.dataset.error = `This diagram didn't render: ${String(error?.message ?? error).split("\n")[0]}`;
            }
          }
          probe.remove();
          fit();
        };
        if (blocks.length) {
          const script = Object.assign(document.createElement("script"), {
            src: "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js",
            integrity: "sha384-8xUhuLNMjW/cI2Dacg3DR4WliYznvIg0LVG1stctThKD/YVrJFI9TNCFxft5NYgp",
            crossOrigin: "anonymous",
            referrerPolicy: "no-referrer",
          });
          script.addEventListener("load", async () => {
            // Labels measured in the fallback font come out too narrow once the web font arrives.
            await document.fonts.ready;
            render();
            // Redraw when the theme changes, from the control, Lectern or the system.
            new MutationObserver(render).observe(document.documentElement, { attributeFilter: ["data-theme"] });
            matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
            addEventListener("resize", fit);
          });
          document.head.append(script);
        }
      }
    