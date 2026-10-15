# Alkamy WP Block Catalog companion skill

This skill guides an AI agent through version-specific WordPress block lookup, environment comparison, runtime registration checks and stored markup evidence. It requires a separately configured WP Block Catalog MCP server.

## Requirements and setup

The companion server is [wp-block-catalog-mcp](https://github.com/danielk-am/wp-block-catalog-mcp), maintained by Alkamy. Release 0.2.0 uses the package name `@alkamy/wp-block-catalog-mcp` and the MIT licence for original code and documentation. It requires Node.js 20+ and npm, and is not published to npm. Follow the server README for catalogue, runtime and verification paths, and its third-party notices for upstream material.

Connect the server through your agent's supported MCP configuration. Connection to Agensi delivers the skill instructions; it does not itself install or connect this second server. No live-site credentials are needed for the committed public catalogue.

For a directly supplied local skill, place this whole folder in the client's supported skills directory. Examples include `.cursor/skills/` for Cursor and `.github/skills/` for project-scoped GitHub Copilot skills. Check the client's current documentation and confirm it discovers the skill. Review the folder before installing it.

When delivered through Agensi, use its connector flow and delivery terms rather than copying marketplace-delivered skill files to disk. Supporting-file access and the companion-server combination still require an Agensi integration test.

## Try it

"Use WP Block Catalog MCP to inspect core/paragraph in wordpress@7.0.2. Show its attributes and the source and runtime evidence separately."

"Compare core/paragraph in wordpress@7.0.2 and wordpress@7.0.2+gutenberg@23.6.2. Tell me what actually changed."

"Check whether jetpack/business-hours is available in the catalogue's disconnected Jetpack profile. Keep that conclusion specific to the profile."

For a generation test, request `core/paragraph` with `content` equal to `Hello catalogue` in `wordpress@7.0.2`. Then change the content and check that missing evidence remains explicit.

## Limits

The skill does not add environments or execute a new runtime verification. Coverage follows the connected catalogue. It does not inspect or edit a live site, publish content, or guarantee editor validity for arbitrary markup. General WordPress development stays with the project's normal workflow.

This package contains original instructions only. It includes no MCP implementation, source checkouts, runtime bundles, private catalogue, credentials or dependencies. Alkamy distributes this companion skill under the [MIT License](LICENSE). Copyright (c) 2026 Alkamy.

Format references: [Agent Skills specification](https://agentskills.io/specification), [Cursor skills](https://cursor.com/docs/skills), [GitHub Copilot skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills).

Release validation: Codex CLI exercised the real MCP workflow on 15 October 2026. Claude Code, Cursor, Copilot and Agensi delivery remain untested. See the repository demonstration for the executed cases.
