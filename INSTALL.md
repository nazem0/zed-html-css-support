# Install (dev extension)

Per [Developing Extensions](https://zed.dev/docs/extensions/developing-extensions).

1. Install Rust ([rustup](https://www.rust-lang.org/tools/install)); Zed will pull `wasm32-wasip2` as needed
2. Install Node.js and ensure it is on `PATH`
3. On Windows: MinGW (WinLibs) or MSVC Build Tools for the WASM build
4. Zed → Extensions → **Install Dev Extension** → select this repository folder
5. Open `demo/index.html`, type inside `class="`, trigger completions

```bash
node server/lsp-smoke.mjs
```
