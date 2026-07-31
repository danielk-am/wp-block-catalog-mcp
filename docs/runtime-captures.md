# Runtime captures

Public profiles captured 2026-07-30.

Every public profile uses WordPress 7.0.2, PHP 8.3.32, `en_US`, UTC, and the Twenty
Twenty-Five block theme. Source commits and registry hashes are sealed in the
matching `runtime/*.exact-environment.json` file.

| Environment | PHP registry | Client registry | Reconciled source definitions | Source-only | Verified records |
| --- | ---: | ---: | ---: | ---: | ---: |
| WordPress 7.0.2 | 110 | 109 | 109 | 0 | 3 |
| + Gutenberg 23.6.2 | 160 | 116 | 123 | 3 | 3 |
| + WooCommerce 10.9.4 | 285 | 264 | 283 | 3 | 1 |
| + Jetpack 16.0.1, disconnected/offline | 110 | 109 | 155 | 46 | 1 core smoke |

## WordPress

- Profile hash:
  `5d92155036a77bd9cd556be7f9cfbb1adafcdfd00ee570a66e3042d9fc4dd347`
- Server registry:
  `edb36d9b28a6b30024fef71e9c715f25753e45806120f4c3bd382d7c32ea9738`
- Client registry:
  `71c22ba9c0d36700a430adda7f6cb623c5a7729f7ea12bb9613389be8d36ced3`
- One server-only block: `core/post-comments`.
- Passed evidence: Paragraph static save, Image v1 deprecation migration, and
  Latest Posts dynamic render.

## Gutenberg

- Profile hash:
  `36a2cd24489dc910aa1f4fec514014a7d17409cb7ee1d72f582a07b4f7108b57`
- Server registry:
  `9a1a2a82acf9a9f384cbf2a40515640797672ce863740819898623791949bbd5`
- Client registry:
  `d5a8e993104c64d1202513685afa6e644b98f6ab442ab1e2d291f2d30d6dd53f`
- Source-only and gated: `core/form`, `core/form-input`, and
  `core/form-submission-notification`.
- Forty server-only names include `core/post-comments` and 39 social-link
  providers.
- Passed evidence: Paragraph static save, Image v1 deprecation migration, and
  Latest Posts dynamic render.

## WooCommerce

- Profile hash:
  `808e3ed2d86dc7118bb6c96f56a97b5ed5d77d8ac9e8ef0b4197dad2a3cf7484`
- Server registry:
  `b898b847dc968dba51c6ae3fa3be9af5979b6ea48e4933529095d45d08f9d179`
- Client registry:
  `559f5920b75dc27b754f5c1d582001d84b484de7f510c72a9563b63dbf4597e0`
- Source-only and feature-disabled: `woocommerce/add-to-wishlist-button`,
  `woocommerce/saved-for-later`, and `woocommerce/wishlist`.
- Runtime-only WooCommerce names include `woocommerce/cart`,
  `woocommerce/legacy-template`, `woocommerce/product-query`, and
  `woocommerce/product-search`.
- Passed evidence: `woocommerce/store-notices` dynamic render.

## Jetpack

The local Jetpack runtime entered localhost Offline Mode with no site token,
connection owner, or blog ID. The capture records this state without forcing a
connection.

- Profile hash:
  `ab4746f4b99137fb7d52f8f1468d8432a556244c2b879c51ab33fa22f29214ad`
- Server registry:
  `146199bbc17b277be407eb3d0f3f89b03d056308254fafc073a927e4287615ee`
- Client registry:
  `79fbb79d6d3890b800b8061bc5a3ca266acaa2c7452cbd370459a336141bda66`
- No Jetpack or premium-content block registered.
- All 46 Jetpack source definitions remain visible as excluded runtime drift.
- The verification bundle contains one core Paragraph smoke and makes no
  Jetpack markup claim.
