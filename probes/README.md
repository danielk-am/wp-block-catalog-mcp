# Runtime probes

These probes run inside the exact WordPress product environment described by a catalogue environment and profile. They do not infer registration or markup behaviour from source files.

## Server registry

Load the read-only WP-CLI command into an already-provisioned environment:

```bash
wp --require=probes/php/wp-block-catalog-probe.php \
  block-catalog snapshot \
  --environment=wordpress@7.0.2 \
  --profile=profiles/wordpress-7.0.2-post-editor.json \
  --output=runtime/wordpress-7.0.2-post-editor.server.json
```

The command captures the final registry after plugins have loaded. Callback bodies are never returned, only callback presence. A second command renders one registered block for a deterministic dynamic fixture:

```bash
wp --require=probes/php/wp-block-catalog-probe.php \
  block-catalog render core/latest-posts \
  --attributes='{"postsToShow":2}'
```

## Client registry and serialization

Load `browser/client-probe.js` in a real editor, after WordPress and product scripts have registered their block types. Playwright can then call:

```js
await page.addScriptTag({ path: 'probes/browser/client-probe.js' });

const snapshot = await page.evaluate(async () => {
  return window.wpBlockCatalogProbe.capture({
    environmentId: 'wordpress@7.0.2',
    editorSurface: 'post-editor',
    profile: {
      themeType: 'block',
      featureFlags: {},
      locale: 'en_US',
    },
  });
});
```

The same probe exposes `verifyStatic`, `verifyMarkup`, and `verifyDeprecatedFixture`. Their results are evidence inputs for the verifier. They are not verification labels by themselves: the catalogue records the exact environment, profile hash, runtime hash, and successful operation before granting a label.

Do not use `wp eval`, return callback source, or put private identifiers,
feature gates, tokens, or customer data in public artefacts.
