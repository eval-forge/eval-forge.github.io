<p align="center">
  <img src="logo.svg" alt="Eval Forge logo" width="96">
</p>

<h1 align="center">Eval Forge</h1>

<p align="center">
  Putting AI models to the test.<br>
  Explore the prompts. Compare the results.
</p>

<p align="center">
  <a href="https://eval-forge.github.io/"><img alt="Live site" src="https://img.shields.io/badge/live%20site-eval--forge.github.io-2b6cb0"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen"></a>
</p>

---

## What is this?

Eval Forge is a small collection of head-to-head tests for AI models. Each test gives the same prompt to several models, then puts the results side by side so you can judge them yourself.

The site is a static page (plain HTML, no build step), hosted on GitHub Pages.

## The tests

| #   | Test                  | Category         | Models                                              |
| --- | --------------------- | ---------------- | --------------------------------------------------- |
| 1   | Orbital Relic         | Creative coding  | Claude Opus 5.5, GPT-6 Astra, Claude Sonnet 5.5     |
| 2   | Lighthouse Cove       | _Coming soon_    | _Being added_                                       |

Each test shows the original prompt in full, so you can read exactly what every model was asked to build.

## Running it locally

There is nothing to install.

```bash
git clone https://github.com/eval-forge/eval-forge.github.io.git
cd eval-forge.github.io
open index.html   # or just double-click it
```

## Project layout

```
.
├── index.html   # the whole site: styles, tests, and prompts
├── logo.svg     # brand mark
├── LICENSE
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
└── SECURITY.md
```

## Contributing

Found a flaw in a test, a broken link, or have a model you want tested? Read [CONTRIBUTING.md](CONTRIBUTING.md) and open a pull request or issue.

## Security

To report a vulnerability, please follow the process in [SECURITY.md](SECURITY.md). Do not open a public issue for it.

## License

Released under the [MIT License](LICENSE).
