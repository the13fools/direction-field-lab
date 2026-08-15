import "./solver-stories.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import { initializeHomeFlowPreview } from "../ui/home-flow-preview";

for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
  katex.render(element.dataset.latex!, element, {
    displayMode: true,
    output: "htmlAndMathml",
    throwOnError: false,
  });
}

initializeHomeFlowPreview();
