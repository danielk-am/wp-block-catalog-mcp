# Third-party notices

The root [MIT License](LICENSE) covers Alkamy's original catalogue software and
documentation. It does not replace the licences of third-party material.

## Catalogue sources

The catalogue preserves upstream block metadata and provenance. Runtime evidence
may also contain upstream-derived markup. Keep those source references and any
applicable upstream notices when redistributing the catalogue or its records.

| Product | Source manifest | Upstream source |
| --- | --- | --- |
| WordPress | [WordPress manifest](sources/wordpress-7.0.2.json) | [WordPress source](https://github.com/WordPress/wordpress-develop) |
| Gutenberg | [Gutenberg manifest](sources/gutenberg-23.6.2.json) | [Gutenberg source and licence](https://github.com/WordPress/gutenberg) |
| WooCommerce | [WooCommerce manifest](sources/woocommerce-10.9.4.json) | [WooCommerce source and licence](https://github.com/woocommerce/woocommerce) |
| Jetpack | [Jetpack manifest](sources/jetpack-16.0.1.json) | [Jetpack source and licence](https://github.com/Automattic/jetpack) |

Each manifest identifies the immutable upstream commit and paths used. Upstream
material remains subject to the terms applicable at that revision. The Alkamy
copyright notice does not assert authorship of upstream blocks or relicense them
under MIT. Product names identify compatibility and provenance, not endorsement.

Unmodified licence documents from the pinned source revisions accompany this
release in [licenses](licenses): [WordPress](licenses/wordpress-LICENSE.txt),
[Gutenberg](licenses/gutenberg-LICENSE.txt),
[WooCommerce](licenses/woocommerce-LICENSE.txt) and
[Jetpack](licenses/jetpack-LICENSE.txt).

## Brand assets

Alkamy logo files in `assets/` are supplied for identification of this project.
The MIT grant for software and documentation does not grant trademark rights or
permission to imply Alkamy's endorsement of a modified or separate product.

## Dependencies

Installed dependencies retain their own copyright notices and licences. The
lockfile records resolved packages and licence metadata. Preserve the relevant
licence files and notices when distributing dependencies; a source checkout
does not bundle `node_modules`.
