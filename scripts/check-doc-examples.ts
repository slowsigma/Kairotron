// Extract every ```ts run block from the docs and execute it — the plan's
// "documentation cannot drift from the engine" gate. Each block is a
// self-contained program importing from "kairotron" (a tsconfig path alias
// for src/index.ts), and each asserts its own numbers: importing the module
// IS the test. After execution, the extracted files are typechecked with the
// project's strict compiler settings (esbuild executes without checking).

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const tmpDir = join(root, ".tmp", "docs-examples");
const DESIGN_DOCS = new Set(["plan.md", "Concept-Search.md", "time-varying-values.md"]);

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".vitepress" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md") && !DESIGN_DOCS.has(entry.name)) out.push(full);
  }
  return out.sort();
}

interface Block {
  file: string;
  line: number;
  code: string;
  out: string;
}

// VitePress's own heading slugifier (copied from its shared utils, which are
// not publicly exported) — anchors are validated with the exact function the
// site uses to mint them.
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;
const slugify = (s: string): string =>
  s.normalize("NFKD").replace(rCombining, "").replace(rControl, "").replace(rSpecial, "-")
    .replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").replace(/^(\d)/, "_$1").toLowerCase();

// VitePress fails the build on dead *pages* but not dead *anchors* — this
// closes the gap for every internal link in the docs set.
function checkInternalLinks(): number {
  const pages = markdownFiles(docsDir);
  const headings = new Map<string, Set<string>>();
  const links: { file: string; line: number; href: string }[] = [];
  for (const file of pages) {
    const rel = relative(root, file);
    const slugs = new Set<string>();
    let fenced = false;
    for (const [i, text] of readFileSync(file, "utf8").split("\n").entries()) {
      if (/^\s*```/.test(text)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const heading = /^#{1,6}\s+(.*)$/.exec(text);
      if (heading) slugs.add(slugify(heading[1]!));
      for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)/g)) {
        const href = m[1]!;
        if (/^(https?:|mailto:)/.test(href)) continue;
        links.push({ file: rel, line: i + 1, href });
      }
    }
    headings.set(rel, slugs);
  }
  let bad = 0;
  for (const { file, line, href } of links) {
    const [page, anchor] = href.split("#");
    let mdFile: string | undefined;
    if (page === "" || page === undefined) mdFile = file; // same-page anchor (relative already)
    else {
      const abs = page.startsWith("/")
        ? join(docsDir, page)
        : resolve(dirname(join(root, file)), page!);
      for (const cand of [abs, `${abs}.md`, join(abs, "index.md")])
        if (headings.has(relative(root, cand))) {
          mdFile = relative(root, cand);
          break;
        }
    }
    if (mdFile === undefined) {
      bad++;
      console.error(`dead link   ${file}:${line} → ${href}`);
      continue;
    }
    if (anchor && !headings.get(mdFile)!.has(slugify(anchor))) {
      bad++;
      console.error(`dead anchor ${file}:${line} → ${href}`);
    }
  }
  return bad;
}

// ```ts run: language "ts", "run" anywhere in the info string marks execution.
function extractBlocks(): Block[] {
  const blocks: Block[] = [];
  for (const file of markdownFiles(docsDir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let open: { info: string; start: number } | undefined;
    for (let i = 0; i < lines.length; i++) {
      const fence = /^\s*```(.*)$/.exec(lines[i]!);
      if (!fence) continue;
      const info = fence[1]!.trim();
      if (!open) {
        if (info.split(/\s+/)[0] === "ts") open = { info, start: i };
        continue;
      }
      if (info !== "") continue; // closing fence is bare
      if (open.info.split(/\s+/).includes("run")) {
        blocks.push({
          file: relative(root, file),
          line: open.start + 1,
          code: lines.slice(open.start + 1, i).join("\n"),
          out: "",
        });
      }
      open = undefined;
    }
    if (open) throw new Error(`unterminated code fence at ${file}:${open.start + 1}`);
  }
  return blocks;
}

const slug = (b: Block, i: number): string =>
  `${String(i).padStart(2, "0")}-${b.file.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "")}-${b.line}.ts`;

async function main(): Promise<void> {
  const badLinks = checkInternalLinks();
  const blocks = extractBlocks();
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  let failed = 0;
  for (const [i, block] of blocks.entries()) {
    const path = join(tmpDir, slug(block, i));
    writeFileSync(path, block.code + "\n");
    try {
      await import(pathToFileURL(path).href);
      console.log(`  ok  ${block.file}:${block.line}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${block.file}:${block.line}`);
      console.error(
        `      ${e instanceof Error ? (e.stack ?? e.message).split("\n").join("\n      ") : String(e)}`,
      );
    }
  }

  // Strict typecheck of the same extracted files, engine settings included.
  writeFileSync(
    join(tmpDir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: relative(tmpDir, join(root, "tsconfig.json")).replaceAll("\\", "/"),
        include: ["*.ts"],
      },
      null,
      2,
    ) + "\n",
  );
  const tsc = join(root, "node_modules", ".bin", "tsc");
  const res = spawnSync(tsc, ["-p", tmpDir, "--noEmit"], { encoding: "utf8" });
  if (res.status !== 0) {
    failed++;
    console.error("FAIL  docs examples typecheck\n" + (res.stdout ?? "") + (res.stderr ?? ""));
  }

  const total = failed + badLinks;
  console.log(
    `docs-examples: ${blocks.length} blocks, ${badLinks ? `${badLinks} dead link(s), ` : ""}` +
      (total ? `${total} FAILED` : "all ok"),
  );
  if (total > 0) process.exit(1);
}

await main();
