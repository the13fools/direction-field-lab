import { formatElementProgram, validateElementProgram, type VertexElementProgram } from "./element-program";

export interface ExperimentPublicationUrls {
  full: string;
  embed: string;
}

function encodedProgram(program: VertexElementProgram): string {
  const parameters = new URLSearchParams();
  parameters.set("program", formatElementProgram(validateElementProgram(program)).trim());
  return parameters.toString();
}

export function experimentPublicationUrls(
  pageUrl: string,
  value: VertexElementProgram,
): ExperimentPublicationUrls {
  const hash = encodedProgram(value);
  const full = new URL(pageUrl);
  full.searchParams.delete("embed");
  full.hash = hash;
  const embed = new URL(full);
  embed.searchParams.set("embed", "1");
  return { full: full.toString(), embed: embed.toString() };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function generateBlogEmbedHtml(pageUrl: string, value: VertexElementProgram): string {
  const program = validateElementProgram(value);
  const urls = experimentPublicationUrls(pageUrl, program);
  return `<figure class="geometry-lab-embed">
  <iframe
    title="${escapeHtmlAttribute(program.name)} — interactive geometry-processing experiment"
    src="${escapeHtmlAttribute(urls.embed)}"
    loading="lazy"
    allow="clipboard-write"
    style="width:100%;height:680px;border:0;border-radius:14px;overflow:hidden"
  ></iframe>
  <figcaption>
    <a href="${escapeHtmlAttribute(urls.full)}">Open the full lab, inspect the energy, and download the experiment</a>
  </figcaption>
</figure>
`;
}

export function generateBlogMarkdown(pageUrl: string, value: VertexElementProgram): string {
  const program = validateElementProgram(value);
  const urls = experimentPublicationUrls(pageUrl, program);
  return `## Try the experiment

${program.description}

[Open **${program.name}** as an interactive experiment](${urls.full})

The linked page contains the complete element program in its URL. It can run on
static hosting without a compiler or account, and it can export the same program
as TinyAD C++ and Python source.
`;
}
