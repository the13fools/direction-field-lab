import "./getting-started.css";

const toast = document.getElementById("copy-toast");

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    window.prompt("Copy these commands", value);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-source]")) {
  button.addEventListener("click", async () => {
    const id = button.dataset.copySource;
    const source = id ? document.getElementById(id) : null;
    if (!source) return;
    await copyText(source.textContent?.trim() ?? "");
    button.textContent = "Copied";
    if (toast) {
      toast.textContent = "Commands copied";
      toast.classList.add("visible");
      window.setTimeout(() => toast.classList.remove("visible"), 1800);
    }
    window.setTimeout(() => { button.textContent = "Copy"; }, 1800);
  });
}
