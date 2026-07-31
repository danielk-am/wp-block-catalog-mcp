# Catalogue audit

Audited 2026-07-30.

| Product | Release or deploy | Commit | Canonical metadata |
| --- | --- | --- | ---: |
| WordPress | 7.0.2 | `855551c4477bd5a0407221c57dae123c4163b434` | 109 |
| Gutenberg | 23.6.2 | `675c2a37a5b49f183fa80d7d03e4bd5779646808` | 123 |
| WooCommerce | 10.9.4 | `884d89cbccaccc8e0b9c2c26f91c51df67e66cab` | 174 |
| Jetpack | 16.0.1 | `4c79b22036b83e8c03a4354ad67f54a5241319b0` | 46 |

Metadata presence is not availability. Every runtime snapshot must record source presence, build inclusion, server registration, client registration, inserter visibility, editor surface, feature gates, and the resolved product environment independently.

## Resolution rules

- WordPress plus Gutenberg: the selected Gutenberg build replaces matching core block registrations. Preserve the shadowed core definition and expose the plugin definition as effective.
- WooCommerce and Jetpack: use the final PHP and client registries. Both inject render callbacks absent from `block.json`, and both gate registrations by environment.
- Public artefacts reject non-public source manifests, block names, paths,
  selector details, revisions, provenance, and gate references.

## Runtime probe contract

Capture the final PHP registry after `init`, the authenticated block-types REST response, allowed block types for each editor context, and the resolved product versions and profile. Then load the real editor and capture client block types, variations, styles, transforms, relationships, inserter visibility, save serialization, parsing, and validation.

Dynamic classification comes only from the registered block type. Static markup verification uses the exact release editor runtime. Dynamic output uses the matching PHP runtime. Deprecation fixtures run through WordPress migration and current serialization.

## Acceptance matrix

- WordPress/Gutenberg: paragraph overlay, Buttons nesting, Latest Posts dynamic render, Image deprecation, Form experiment gate.
- WooCommerce: Accordion nesting, Product Price context/render, Cart template/render, Add to Cart with Options theme gate, shopper-list feature/context matrix.
- Jetpack: Business Hours fixtures, Calendly deprecation, Repeat Visitor state render, Google Docs beta gate, donations/premium-content graph.
