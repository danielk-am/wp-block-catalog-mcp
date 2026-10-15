# Connect an MCP client

Requires Node.js 20 or newer and npm. First clone and build the server:

```bash
git clone https://github.com/danielk-am/wp-block-catalog-mcp.git
cd wp-block-catalog-mcp
npm ci
npm run verify
```

The package is not published to npm. Run the built server from this checkout.
Only Codex has been exercised with this release. Examples for other clients
are configuration guidance, not a claim of tested compatibility.

## Server command

Start the stdio MCP server with the committed public catalogue and runtime
evidence:

```bash
WP_BLOCK_CATALOG_PATH="$PWD/catalog/public.release.generated.json" \
WP_BLOCK_DEFAULT_ENVIRONMENT="wordpress@7.0.2" \
WP_BLOCK_RUNTIME_PATHS="$PWD/runtime/wordpress-7.0.2-post-editor.reconciled.json:$PWD/runtime/wordpress-7.0.2-gutenberg-23.6.2-post-editor.reconciled.json:$PWD/runtime/wordpress-7.0.2-woocommerce-10.9.4-post-editor.reconciled.json:$PWD/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.reconciled.json" \
WP_BLOCK_VERIFICATION_PATHS="$PWD/runtime/wordpress-7.0.2.verified-markup.json:$PWD/runtime/wordpress-7.0.2-gutenberg-23.6.2.verified-markup.json:$PWD/runtime/wordpress-7.0.2-woocommerce-10.9.4.verified-markup.json:$PWD/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected.verified-markup.json" \
npm start
```

## JSON client configuration

For clients using the `mcpServers` format, use absolute paths:

```json
{
  "mcpServers": {
    "wp-block-catalog": {
      "command": "node",
      "args": ["/absolute/path/wp-block-catalog-mcp/dist/mcp/server.js"],
      "env": {
        "WP_BLOCK_CATALOG_PATH": "/absolute/path/wp-block-catalog-mcp/catalog/public.release.generated.json",
        "WP_BLOCK_DEFAULT_ENVIRONMENT": "wordpress@7.0.2",
        "WP_BLOCK_RUNTIME_PATHS": "/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-post-editor.reconciled.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-gutenberg-23.6.2-post-editor.reconciled.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-woocommerce-10.9.4-post-editor.reconciled.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.reconciled.json",
        "WP_BLOCK_VERIFICATION_PATHS": "/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2.verified-markup.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-gutenberg-23.6.2.verified-markup.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-woocommerce-10.9.4.verified-markup.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected.verified-markup.json"
      }
    }
  }
}
```

`*_PATHS` uses the operating system path delimiter, `:` on macOS and Linux or
`;` on Windows. Singular `*_PATH` and plural `*_PATHS` settings can be
combined. Duplicate environment bundles or verification record identities
stop the server at startup.

## Codex configuration

Add the following TOML to `~/.codex/config.toml`, replacing
`/absolute/path/wp-block-catalog-mcp` with your checkout path.
Do not paste the JSON wrapper into this file.

```toml
[mcp_servers.wp-block-catalog]
command = "node"
args = ["/absolute/path/wp-block-catalog-mcp/dist/mcp/server.js"]

[mcp_servers.wp-block-catalog.env]
WP_BLOCK_CATALOG_PATH = "/absolute/path/wp-block-catalog-mcp/catalog/public.release.generated.json"
WP_BLOCK_DEFAULT_ENVIRONMENT = "wordpress@7.0.2"
WP_BLOCK_RUNTIME_PATHS = "/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-post-editor.reconciled.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-gutenberg-23.6.2-post-editor.reconciled.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-woocommerce-10.9.4-post-editor.reconciled.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.reconciled.json"
WP_BLOCK_VERIFICATION_PATHS = "/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2.verified-markup.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-gutenberg-23.6.2.verified-markup.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-woocommerce-10.9.4.verified-markup.json:/absolute/path/wp-block-catalog-mcp/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected.verified-markup.json"
```

Check it with `codex mcp get wp-block-catalog`.

## Other client configuration locations

Use your client's supported MCP setup and translate the command, arguments,
and environment variables above into its format:

- Claude Code stores user-scoped servers in its user configuration. Check the result with `claude mcp get wp-block-catalog`.
- Claude Desktop stores the definition under `mcpServers` in `claude_desktop_config.json`.
- VS Code and VSCodium store the same server object under `servers` in the user `mcp.json`. Their `--add-mcp` command accepts the definition as JSON.
- Gemini CLI stores the definition under `mcpServers` in `~/.gemini/settings.json`. Check it with `gemini mcp list` from a trusted folder.

Restart desktop and IDE clients after changing their user configuration.

## Check the connection

Ask the connected agent:

> List the available WordPress environments. In wordpress@7.0.2, inspect
> core/paragraph, then retrieve stored markup for content "Hello catalogue".
> Explain what the evidence establishes.

The known fixture should return the bytes in the [recorded demonstration](demo.md).
The server uses stdio, so running `npm start` alone waits for an MCP client;
it does not open a web page.

Install the optional [companion skill](../skills/using-wp-block-catalog-mcp)
through your client's supported skills mechanism. It guides environment selection,
schema inspection, comparisons, and evidence handling. Release assets include a
standalone skill ZIP.

[Back to the README](../README.md)
