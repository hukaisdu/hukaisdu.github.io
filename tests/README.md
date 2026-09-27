# Site checks

Build with the Jekyll 3.10 version specified in the repository's Gemfile.lock.
Use a separate output directory so the tracked `_site` folder is not overwritten:

```sh
bundle exec jekyll build --safe --destination /tmp/personal-site-check
cd tests
npm install
SITE_DIR=/tmp/personal-site-check npm test
```

On PowerShell, set `$env:SITE_DIR` to the absolute build directory before running
`npm test`. `pnpm install` / `pnpm test` also work with the included lockfile.

The tests run the generated publication script in a DOM, exercising both languages,
combined filters, reset, empty results, and the actual downloaded BibTeX contents.
They also check page languages, local links, icons, and build exclusions.
