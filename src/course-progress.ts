import "./course-progress.css";

interface CourseLesson {
  path: string;
  unit: string;
  title: string;
}

interface CourseSupplement {
  kind: string;
  title: string;
  description: string;
}

const LESSONS: readonly CourseLesson[] = [
  { path: "dec-playground.html", unit: "UNIT I · READ THE FIELD", title: "Forms, d, and the Hodge star" },
  { path: "clebsch-surfaces.html", unit: "UNIT I · READ THE FIELD", title: "The physical representation problem" },
  { path: "clebsch-surfaces-action.html", unit: "UNIT I · READ THE FIELD", title: "Clebsch variables in action" },
  { path: "disk-circulation.html", unit: "UNIT II · CIRCULATION + TOPOLOGY", title: "From a disk to an annulus" },
  { path: "flat-torus-cohomology.html", unit: "UNIT II · CIRCULATION + TOPOLOGY", title: "Two harmonic periods on a torus" },
  { path: "random-fluids.html", unit: "UNIT III · KINEMATICS", title: "Random fields and pressure projection" },
  { path: "shallow-water.html", unit: "UNIT IV · DYNAMICS", title: "Conservative shallow-water baseline" },
  { path: "clebsch-shallow-water.html", unit: "UNIT IV · DYNAMICS", title: "Clebsch shallow water" },
];

const SUPPLEMENTS: Record<string, CourseSupplement> = {
  "solver-stories.html": {
    kind: "ORIENTATION",
    title: "How should a fluid remember?",
    description: "Backtracing, APIC, Clebsch transport, and conservative updates.",
  },
  "clebsch-surfaces-reference.html": {
    kind: "BACKGROUND NOTEBOOK",
    title: "Clebsch, exterior calculus, and nearby work",
    description: "Types, storage locations, gauges, and research connections.",
  },
};

const DRAWER_SUPPLEMENTS = ["solver-stories.html", "clebsch-surfaces-reference.html"] as const;

const currentPath = window.location.pathname.split("/").pop() || "index.html";
const lessonIndex = LESSONS.findIndex((lesson) => lesson.path === currentPath);
const supplement = SUPPLEMENTS[currentPath];

function lessonLink(lesson: CourseLesson | undefined, direction: "previous" | "next"): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.className = `course-progress-${direction}`;
  if (!lesson) {
    anchor.href = "./course.html";
    anchor.innerHTML = direction === "previous" ? "<span>COURSE MAP</span><strong>See the complete path</strong>" : "<span>COURSE MAP</span><strong>Review the complete path</strong>";
    return anchor;
  }
  anchor.href = `./${lesson.path}`;
  anchor.innerHTML = direction === "previous"
    ? `<span>← PREVIOUS</span><strong>${lesson.title}</strong>`
    : `<span>NEXT →</span><strong>${lesson.title}</strong>`;
  return anchor;
}

function createMenuIcon(): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "course-progress-menu-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  return icon;
}

function createDrawer(): {
  drawer: HTMLElement;
  scrim: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  currentLink?: HTMLAnchorElement;
} {
  const scrim = document.createElement("button");
  scrim.type = "button";
  scrim.className = "course-drawer-scrim";
  scrim.tabIndex = -1;
  scrim.setAttribute("aria-label", "Close course navigation");

  const drawer = document.createElement("aside");
  drawer.id = "course-drawer";
  drawer.className = "course-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "course-drawer-title");
  drawer.setAttribute("aria-hidden", "true");

  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.innerHTML = '<span>SITE NAVIGATION</span><strong id="course-drawer-title">Direction fields + shallow water</strong>';
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "course-drawer-close";
  closeButton.setAttribute("aria-label", "Close course navigation");
  closeButton.textContent = "×";
  header.append(heading, closeButton);

  const overview = document.createElement("a");
  overview.className = "course-drawer-overview";
  overview.href = "./course.html";
  overview.innerHTML = "<span>GUIDED ROUTE</span><strong>Open the shallow-water course</strong><i>Four units · eight lessons →</i>";

  const gallery = document.createElement("a");
  gallery.className = "course-drawer-gallery";
  gallery.href = "./index.html";
  gallery.innerHTML = "<span>OPEN EXPLORATION</span><strong>Browse the Direction Field Lab</strong><i>Independent geometry-processing experiments →</i>";

  const navigation = document.createElement("nav");
  navigation.className = "course-drawer-lessons";
  navigation.setAttribute("aria-label", "All course lessons");

  let currentLink: HTMLAnchorElement | undefined;
  let lastUnit = "";
  let unitList: HTMLOListElement | undefined;
  LESSONS.forEach((lesson, index) => {
    if (lesson.unit !== lastUnit) {
      const section = document.createElement("section");
      const unitTitle = document.createElement("h2");
      unitTitle.textContent = lesson.unit;
      unitList = document.createElement("ol");
      section.append(unitTitle, unitList);
      navigation.append(section);
      lastUnit = lesson.unit;
    }

    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = `./${lesson.path}`;
    anchor.innerHTML = `<b>${String(index + 1).padStart(2, "0")}</b><span>${lesson.title}</span><i>→</i>`;
    if (lesson.path === currentPath) {
      anchor.classList.add("current");
      anchor.setAttribute("aria-current", "page");
      currentLink = anchor;
    }
    item.append(anchor);
    unitList!.append(item);
  });

  const branches = document.createElement("section");
  branches.className = "course-drawer-branches";
  const branchTitle = document.createElement("h2");
  branchTitle.textContent = "COURSE NOTEBOOKS";
  const branchList = document.createElement("ul");
  DRAWER_SUPPLEMENTS.forEach((path) => {
    const item = SUPPLEMENTS[path]!;
    const listItem = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = `./${path}`;
    anchor.innerHTML = `<span><b>${item.kind}</b><strong>${item.title}</strong><small>${item.description}</small></span><i>→</i>`;
    if (path === currentPath) {
      anchor.classList.add("current");
      anchor.setAttribute("aria-current", "page");
      currentLink = anchor;
    }
    listItem.append(anchor);
    branchList.append(listItem);
  });
  branches.append(branchTitle, branchList);
  navigation.append(branches);

  const footer = document.createElement("footer");
  footer.innerHTML = '<a href="./index.html">← Lab gallery</a><a href="./references.html#flow">Reading map →</a>';

  drawer.append(header, overview, gallery, navigation, footer);
  document.body.append(scrim, drawer);
  return { drawer, scrim, closeButton, currentLink };
}

if (lessonIndex >= 0 || supplement) {
  const progress = document.createElement("nav");
  progress.className = "course-progress";
  progress.setAttribute("aria-label", "Course progress");

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "course-progress-menu";
  menuButton.setAttribute("aria-controls", "course-drawer");
  menuButton.setAttribute("aria-expanded", "false");
  const menuCopy = document.createElement("span");
  menuCopy.className = "course-progress-menu-copy";
  menuCopy.innerHTML = "<span>SITE MAP</span><strong>Course or gallery</strong>";
  menuButton.append(createMenuIcon(), menuCopy);
  progress.append(menuButton);

  const current = document.createElement("div");
  current.className = "course-progress-current";
  if (lessonIndex >= 0) {
    const lesson = LESSONS[lessonIndex]!;
    current.innerHTML = `<span>LESSON ${lessonIndex + 1} OF ${LESSONS.length} · ${lesson.unit}</span><strong>${lesson.title}</strong><i style="--course-progress:${100 * (lessonIndex + 1) / LESSONS.length}%"></i>`;
  } else {
    current.innerHTML = `<span>${supplement!.kind}</span><strong>${supplement!.title}</strong><i style="--course-progress:0%"></i>`;
  }
  progress.append(current);

  const routes = document.createElement("div");
  routes.className = "course-progress-routes";
  if (lessonIndex >= 0) {
    routes.append(lessonLink(LESSONS[lessonIndex - 1], "previous"), lessonLink(LESSONS[lessonIndex + 1], "next"));
  } else {
    const returnLink = document.createElement("a");
    returnLink.href = "./course.html";
    returnLink.innerHTML = "<span>RETURN TO THE SPINE →</span><strong>Choose the next core lesson</strong>";
    routes.append(returnLink);
  }
  progress.append(routes);

  const pageHeader = document.body.querySelector(":scope > header");
  if (pageHeader) pageHeader.insertAdjacentElement("afterend", progress);
  else document.body.prepend(progress);

  const { drawer, scrim, closeButton, currentLink } = createDrawer();
  let previouslyFocused: HTMLElement | null = null;

  const focusableElements = (): HTMLElement[] => Array.from(
    drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );

  const openDrawer = (): void => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("course-drawer-open");
    drawer.classList.add("open");
    scrim.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    menuButton.setAttribute("aria-expanded", "true");
    closeButton.focus();
    currentLink?.scrollIntoView({ block: "center" });
  };

  const closeDrawer = (): void => {
    document.body.classList.remove("course-drawer-open");
    drawer.classList.remove("open");
    scrim.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    menuButton.setAttribute("aria-expanded", "false");
    previouslyFocused?.focus();
  };

  menuButton.addEventListener("click", openDrawer);
  closeButton.addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
