# How evidence lookups work

These examples target the public 0.1.4 catalogue inspected on 15 October 2026. Discover environments again in each session. They are example calls, not promises about future catalogue contents or a user's site.

## Retrieve a known static example

After confirming `wordpress@7.0.2` in `list_environments`, inspect `core/paragraph` with `get_block` and `get_verification_evidence`. Request:

```json
{
  "environment": "wordpress@7.0.2",
  "name": "core/paragraph",
  "attributes": {"content": "Hello catalogue"}
}
```

Pass that object to `generate_markup`. If successful, pass its unchanged `markup` back to `validate_markup` with the same environment and name. Report the returned evidence kind and labels. Changing the text to a new sentence requires its own evidence; a known example does not verify every paragraph.

## Distinguish rendering from saved content

Call `generate_markup` with:

```json
{
  "environment": "wordpress@7.0.2+woocommerce@10.9.4",
  "name": "woocommerce/store-notices",
  "attributes": {"align": "wide"}
}
```

A successful `dynamic-server-render` record establishes the captured server output for those inputs and context. Report rendered HTML, the `server-render-valid` label if returned, and the capture profile. Do not present rendered HTML as an editor serialization recipe.

## Explain a profile-specific exclusion

Call `get_runtime_drift` with:

```json
{
  "environment": "wordpress@7.0.2+jetpack@16.0.1",
  "name": "jetpack/business-hours"
}
```

Inspect the returned availability and profile before concluding. In the inspected disconnected post-editor profile the block is excluded. That observation does not establish availability in a connected Jetpack site or another editor.

## Compare explicitly

```json
{
  "name": "core/paragraph",
  "fromEnvironment": "wordpress@7.0.2",
  "toEnvironment": "wordpress@7.0.2+gutenberg@23.6.2"
}
```

Pass to `compare_block_versions`. Explain only returned differences relevant to the task. A change in source provenance alone does not establish a breaking markup change.

## Useful failure wording

| Observation | Answer |
| --- | --- |
| Requested WordPress/plugin combination is absent | "This catalogue has no exact environment for that combination. I can compare a listed environment, but cannot verify this target from these records." |
| Generation has no record for the requested attributes | "No stored runtime evidence matches these inputs. The schema can still inform a draft, but that draft needs a matching runtime test." |
| Validation returns false | "These bytes have no matching passed record here. This lookup has not established whether WordPress would accept them." |
| MCP server is unavailable | "The companion catalogue server is not connected. The skill alone cannot query block definitions or verify markup." |

For a general plugin, custom block or theme implementation, use the project's development workflow. This skill can supply catalogue evidence to that workflow without taking over its build, test or deployment responsibilities.
