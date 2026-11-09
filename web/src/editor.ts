const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class Editor {
  private mirror: HTMLElement;
  private area: HTMLTextAreaElement;

  constructor(container: HTMLElement, initial: string) {
    container.innerHTML = `<pre class="mirror" aria-hidden="true"></pre><textarea spellcheck="false"></textarea>`;
    this.mirror = container.querySelector(".mirror") as HTMLElement;
    this.area = container.querySelector("textarea") as HTMLTextAreaElement;
    this.area.value = initial;
    this.area.addEventListener("scroll", () => {
      this.mirror.scrollTop = this.area.scrollTop;
      this.mirror.scrollLeft = this.area.scrollLeft;
    });
    this.area.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: eEnd } = this.area;
        this.area.setRangeText("  ", s, eEnd, "end");
      }
    });
    this.render();
  }

  get text(): string {
    return this.area.value;
  }

  set text(value: string) {
    this.area.value = value;
    this.render();
  }

  onRun(cb: () => void): void {
    this.area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        cb();
      }
    });
  }

  private render(highlights: ReadonlySet<number> = new Set()): void {
    const lines = this.area.value.split("\n");
    this.mirror.innerHTML = lines
      .map(
        (line, i) =>
          `<div class="ln${highlights.has(i + 1) ? " hl" : ""}">${escapeHtml(line) || "&nbsp;"}</div>`,
      )
      .join("");
  }

  setHighlights(lines: Iterable<number>): void {
    this.render(new Set(lines));
  }
}
