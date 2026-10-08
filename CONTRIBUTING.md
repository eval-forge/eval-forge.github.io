# Contributing to Eval Forge

Thanks for wanting to help. Eval Forge is a small, static site, so contributions are simple.

## Ways to help

- **Report a problem.** Broken links, wrong model names, layout bugs on phones, or a prompt that was pasted incorrectly. Open an issue with what you saw and where.
- **Suggest a test.** Open an issue describing the prompt, the models you want to compare, and why it's interesting.
- **Improve the site.** Fix a bug, tighten the wording, or improve accessibility.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make your change. The site is a single file, `index.html`, so keep edits focused.
3. Check it in a browser at desktop and phone widths. Make sure:
   - the page has no horizontal scroll,
   - the test cards expand and collapse,
   - the prompt boxes expand and collapse,
   - the links work.
4. Open a pull request with a short description of what changed and why.

## Style

- Match the existing formatting. Don't reformat sections you aren't changing.
- Keep CSS colors as tokens in `:root`, and keep dark mode working.
- Prefer plain HTML and CSS. Add dependencies only when there's a strong reason.

## Adding a new test

Each test is a `<details class="test">` block inside `#tests` in `index.html`. Copy the structure of an existing test, then update:

- the heading and tag,
- the description,
- the result links and model names,
- the original prompt, pasted verbatim.

Use the next free number in the heading (for example, `Test #3 — Title`).

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
