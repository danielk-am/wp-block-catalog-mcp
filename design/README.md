# Banner source

`banner.html` adapts Alkamy's approved WordPress banner template for this MCP
server. It uses the full horizontal logo in `assets/alkamy-logo.svg` and a
typeset excerpt of the actual response recorded in `docs/demo.md`.

Canvas: 1544 × 500. Render the same source with `?scale=0.5` at 772 × 250.
The composition is fixed artwork, not a responsive application interface.

With Playwright installed by `npm ci`, run from the repository root:

```bash
node design/render-banner.mjs
```

The script uses a locally installed Chrome, or Playwright Chromium when Chrome
is unavailable. Install the latter with `npx playwright install chromium`.
Both PNGs are saved in `assets/`. Inspect each at its actual size after editing.
