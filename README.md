# HTML CSS Support for Zed

CSS `id` / `class` IntelliSense for HTML in [Zed](https://zed.dev).

Inspired by [`ecmel/vscode-html-css`](https://github.com/ecmel/vscode-html-css) (MIT). The VS Code host cannot run in Zed, so this is a **Zed-native remake**: a small Node LSP plus a `wasm32-wasip2` launcher.

There does not appear to be an equivalent in [`zed-industries/extensions`](https://github.com/zed-industries/extensions) today (built-in HTML covers markup/CSS language features, not workspace class-name completion like the VS Code extension).

## Features

- Completions for `class`, `id`, and `className` from workspace CSS (and remote stylesheets)
- Go to definition for local selectors
- Configurable `styleSheets` globs via Zed LSP settings

## Install (dev)

See [Zed: Developing Extensions](https://zed.dev/docs/extensions/developing-extensions).

1. Prerequisites: [Rust via rustup](https://www.rust-lang.org/tools/install), Node.js on PATH
2. Zed → Extensions → **Install Dev Extension** → this folder
3. Open `demo/` and trigger completions inside `<button class="`

Troubleshoot: `zed --foreground` or **zed: open log**.

## Settings

```json
{
  "lsp": {
    "html-css-support": {
      "settings": {
        "styleSheets": ["**/*.css", "**/*.scss", "**/*.less"]
      }
    }
  }
}
```

## Smoke test (no Zed)

```bash
node server/lsp-smoke.mjs
```

Expected: `LSP smoke OK: btn, btn-primary, card`

## Layout

```
extension.toml      # Zed manifest
Cargo.toml          # WASM cdylib
src/lib.rs          # language_server_command (embeds + writes server)
server/server.mjs   # Node LSP
demo/               # manual fixture
```

Zed only packages `extension.toml` + `extension.wasm` for this kind of extension. The Node script is embedded at compile time and written into `extensions/work/html-css-support/` on first launch.

## Publish to the Zed gallery

1. Push to https://github.com/nazem0/zed-html-css-support (already set in `extension.toml`)
2. Open a PR against [zed-industries/extensions](https://github.com/zed-industries/extensions) following their [publishing docs](https://zed.dev/docs/extensions/developing-extensions)

## License

MIT — see [LICENSE.md](LICENSE.md). Original VS Code extension © Ecmel Ercan; Zed remake retains that license.
