import "./course-progress.css";

interface CourseLesson {
  path: string;
  unit: string;
  title: string;
}

const LESSONS: readonly CourseLesson[] = [
  { path: "dec-playground.html", unit: "UNIT I · READ THE FIELD", title: "Forms, d, and the Hodge star" },
  { path: "clebsch-surfaces.html", unit: "UNIT I · READ THE FIELD", title: "The physical representation problem" },
  { path: "clebsch-surfaces-action.html", unit: "UNIT I · READ THE FIELD", title: "Clebsch variables in action" },
  { path: "disk-circulation.html", unit: "UNIT II · CIRCULATION + TOPOLOGY", title: "From a disk to an annulus" },
  { path: "flat-torus-cohomology.html", unit: "UNIT II · CIRCULATION + TOPOLOGY", title: "Two harmonic periods on a torus" },
  { path: "random-fluids.html", unit: "UNIT III · KINEMATICS → DYNAMICS", title: "Random kinematic surface fields" },
  { path: "bernoulli-clebsch.html", unit: "UNIT III · KINEMATICS → DYNAMICS", title: "Bernoulli to Clebsch transport" },
  { path: "shallow-water.html", unit: "UNIT IV · SHALLOW WATER", title: "Conservative shallow-water baseline" },
  { path: "clebsch-shallow-water.html", unit: "UNIT IV · SHALLOW WATER", title: "Clebsch shallow water" },
  { path: "mobius-shallow-water.html", unit: "UNIT IV · SHALLOW WATER", title: "Water on a Möbius strip" },
];

const SUPPLEMENTS: Record<string, { kind: string; title: string }> = {
  "clebsch-surfaces-reference.html": { kind: "REFERENCE", title: "Exterior calculus + DEC lookup" },
  "projective-clebsch.html": { kind: "ELECTIVE", title: "Projective Clebsch fields" },
};

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

if (lessonIndex >= 0 || supplement) {
  const progress = document.createElement("nav");
  progress.className = "course-progress";
  progress.setAttribute("aria-label", "Course progress");

  const mapLink = document.createElement("a");
  mapLink.className = "course-progress-map";
  mapLink.href = "./course.html";
  mapLink.innerHTML = "<span>COURSE</span><strong>Clebsch fluids on surfaces</strong>";
  progress.append(mapLink);

  const current = document.createElement("div");
  current.className = "course-progress-current";
  if (lessonIndex >= 0) {
    const lesson = LESSONS[lessonIndex]!;
    current.innerHTML = `<span>LESSON ${lessonIndex + 1} OF ${LESSONS.length} · ${lesson.unit}</span><strong>${lesson.title}</strong><i style="--course-progress:${100 * (lessonIndex + 1) / LESSONS.length}%"></i>`;
  } else {
    current.innerHTML = `<span>${supplement!.kind} · OFF THE CORE SPINE</span><strong>${supplement!.title}</strong><i style="--course-progress:0%"></i>`;
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
}
