import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "Kairotron",
  description:
    "A text-first REPL for discrete-time dynamical systems — write a stock-and-flow model, fold it across a bounded horizon, and see which line of code moved each stock at every tick.",
  cleanUrls: true,
  lastUpdated: true,

  // Served under /docs/ by the REPL (dev proxy in vite.config.ts, dist/docs in builds).
  base: "/docs/",

  // Design notes live beside the docs but are not part of the public set.
  srcExclude: ["plan.md", "Concept-Search.md", "time-varying-values.md"],

  themeConfig: {
    nav: [
      { text: "Guide", activeMatch: "/guide/", link: "/guide/getting-started" },
      { text: "Reference", activeMatch: "/reference/", link: "/reference/dsl" },
      { text: "Contributing", link: "/contributing" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Start here",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Concepts", link: "/guide/concepts" },
          ],
        },
        {
          text: "Guides",
          items: [
            { text: "Browser REPL", link: "/guide/browser-repl" },
            { text: "Tick units & calendar", link: "/guide/units-and-calendar" },
            { text: "Branches & what-if", link: "/guide/branches" },
            { text: "Monte Carlo", link: "/guide/monte-carlo" },
            { text: "Cookbook", link: "/guide/cookbook" },
            { text: "Embedding the engine", link: "/guide/embedding" },
            { text: "Troubleshooting & FAQ", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "DSL", link: "/reference/dsl" },
            { text: "Mini-notation", link: "/reference/mini-notation" },
            { text: "CLI", link: "/reference/cli" },
            { text: "Outputs & exports", link: "/reference/outputs" },
            { text: "Glossary", link: "/reference/glossary" },
            { text: "Additional links", link: "/reference/additional_links" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    outline: "deep",
    footer: {
      message: "MIT licensed.",
      copyright: "Kairotron — fold your system across time.",
    },
  },
});
