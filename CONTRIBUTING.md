# Contributing to Valley Roads

Contributions, bug reports, and suggestions are welcome. For a substantial change, please open an issue first to discuss the idea. For security vulnerabilities, follow the private reporting instructions in [SECURITY.md](SECURITY.md).

## Getting started

1. Fork the repository and create a branch for your change.
2. Install Node.js and dependencies with `npm ci`.
3. Serve the project with `python3 -m http.server 8764 --bind 127.0.0.1`, then open <http://127.0.0.1:8764/> in a WebGL 2 browser.
4. Make your change and run `npm run build`. Test the affected gameplay in your browser; include the seed, browser, and steps when relevant.
5. Open a pull request describing the change and how you tested it. Include screenshots or a short recording for visible changes.

Keep changes focused, follow the existing code style, and avoid committing generated `dist/` output. Changes to vendored three.js files should preserve their existing license notices. By submitting a contribution, you agree to license your contribution under the project's MIT license.

Please follow the [code of conduct](CODE_OF_CONDUCT.md).
