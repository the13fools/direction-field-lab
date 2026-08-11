import "./clebsch-surface.css";
import "katex/dist/katex.min.css";

import katex from "katex";

for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
  katex.render(element.dataset.latex!, element, {
    displayMode: element.classList.contains("cs-math-display"),
    output: "htmlAndMathml",
    throwOnError: false,
  });
}
