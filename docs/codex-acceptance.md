1. **Discovery and paragraph inspection:** `list_environments` returned four environments: `wordpress@7.0.2`, plus Gutenberg `23.6.2`, Jetpack `16.0.1`, or WooCommerce `10.9.4`. For `core/paragraph` in `wordpress@7.0.2`, `get_block` returned API v3 source schema marked `metadata-only`: rich-text `content`, `direction`, `dropCap` defaulting to false, and `placeholder`. Separately, `get_runtime_drift` showed PHP and editor registration, with inserter visibility in `core/edit-post`. Runtime attributes extend the source schema; the client additionally has `fitText`. Markup verification comes from separate stored evidence.

2. **Exact `Hello catalogue` input:** `generate_markup` returned `verified: true`, kind `static-save`, label `save-runtime-valid`, with successful captured save/parse/validate stages. I passed its markup directly to `validate_markup` unchanged; that also returned `verified: true`:
   ```html
   <!-- wp:paragraph -->
   <p>Hello catalogue</p>
   <!-- /wp:paragraph -->
   ```
   Output hash: `fc52c2f7bc6b8fc73c9497f22fdbb09cf185ded7ee2b502e7a79bccead672eb0`.

3. **Exact `Different content` input:** `generate_markup` returned `verified: false`, without markup. This establishes missing exact-input evidence in the catalogue. It does not establish invalid WordPress content. No fixture values were substituted.

4. **Changed markup:** Replacing only `Hello catalogue` with `Different content` and calling `validate_markup` returned `verified: false`: “No passed exact-runtime evidence matches these markup bytes.” **This does not prove WordPress rejects it.**

5. **WooCommerce notices:** In `wordpress@7.0.2+woocommerce@10.9.4`, `generate_markup` with `{"align":"wide"}` returned `verified: true`, kind `dynamic-server-render`, label `server-render-valid`:
   ```html
   <div data-block-name="woocommerce/store-notices" class="wc-block-store-notices woocommerce alignwide wp-block-woocommerce-store-notices"><div class="woocommerce-notices-wrapper"></div></div>
   ```
   Captured evidence records `callbackExecuted: true`. These bytes are rendered HTML; this result does not verify saved block serialization.

6. **Jetpack business hours:** In `wordpress@7.0.2+jetpack@16.0.1`, source metadata exists, but captured PHP/editor registration and inserter visibility are false; state is `excluded`. This applies to `core/edit-post`, `en_US`, Twenty Twenty-Five, with `blocksModule: true`, `connection: disconnected`, `offlineMode: true`, and `variation: production`. It does not establish absence in other Jetpack profiles.

7. **Paragraph comparison:** Comparing `wordpress@7.0.2` → `wordpress@7.0.2+gutenberg@23.6.2` returned changes to source/product/version and provenance, plus `supports.editableRoot` becoming present with value `true`. Provenance changed from WordPress commit `855551c…` to Gutenberg commit `675c2a3…`. No attribute differences were reported.

8. **Hypothetical `wordpress@0.0.0`:** Its exact environment is absent from discovery. That site is unverified; the available `7.0.2` environment cannot verify it.

Tools actually used: catalogue `list_environments`, `get_block`, `get_runtime_drift`, `get_verification_evidence`, `generate_markup`, `validate_markup`, and `compare_block_versions`; resource `list_mcp_resources` and `read_mcp_resource`; and `exec_command` solely to read the project skill. No files were edited, credentials accessed, software installed, or external services used.

Catalogue version: **`2026-10-15-alkamy-pinned`**, manifest generated `2026-10-15T05:54:25.130Z`. Jetpack registry captures date to `2026-07-30T15:52:17Z` (server) and `2026-07-30T15:52:26.012Z` (client). Core, Gutenberg, and WooCommerce registry capture dates are null; returned markup evidence supplies no capture timestamp. Manifest generation time does not establish capture freshness. These calls retrieved stored evidence; **no fresh WordPress execution occurred**.