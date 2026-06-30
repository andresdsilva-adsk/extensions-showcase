# Forma Extensions Showcase

A collection of [Autodesk Forma](https://app.autodeskforma.com) Site Design
embedded-view extensions, hosted on GitHub Pages and registered into Forma by
URL.

## Extensions

| Extension | Type | Hosted URL |
| --- | --- | --- |
| [Terrain Slope Analysis](./slope-analysis/) | Analysis panel | `https://andresdsilva-adsk.github.io/extensions-showcase/slope-analysis/` |

## Live site

- Showcase landing: https://andresdsilva-adsk.github.io/extensions-showcase/
- Slope Analysis: https://andresdsilva-adsk.github.io/extensions-showcase/slope-analysis/

## How deployment works

This repo deploys to GitHub Pages via GitHub Actions
(`.github/workflows/deploy.yml`), following the
[Vite static-deploy guide](https://vite.dev/guide/static-deploy#github-pages).
On every push to `main` the workflow:

1. Installs and builds each extension (`npm install && npm run build`).
2. Assembles a `_site/` directory: the landing page at the root and each
   extension under its own subfolder (e.g. `_site/slope-analysis/`).
3. Publishes `_site/` to GitHub Pages.

Each extension uses a **relative Vite `base` (`"./"`)**, so its assets resolve
correctly when served from a subpath like `/extensions-showcase/slope-analysis/`.

## First-time setup (once per repo)

1. Push this repo to `https://github.com/andresdsilva-adsk/extensions-showcase`.
2. In the repo: **Settings → Pages → Build and deployment → Source = GitHub
   Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab). The
   workflow's deploy step prints the published URL.

## Register an extension in Forma

See [sharing extensions](https://aps.autodesk.com/en/docs/forma/v1/overview/sharing-extensions/).

1. Open a Forma project → left panel → **Extensions** → developer/test entry.
2. Add an extension pointing at the hosted URL above, with placement
   **`RIGHT_MENU_ANALYSIS_PANEL`** (this extension is an analysis panel).
3. Forma issues an **extension ID**. Share that ID with other Forma users — they
   add it via **Extensions → Add extension** (it appears under the
   **Unpublished** tab until it is published to the marketplace).

## Local development

```bash
cd slope-analysis
npm install
npm run dev      # http://localhost:5173/
```

For testing inside Forma locally, install Forma's
[local testing extension](https://aps.autodesk.com/en/docs/forma/v1/embedded-views/getting-started/#local-testing-extension)
and point it at your dev server URL.
