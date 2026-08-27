# 07: README: setup and usage

**What to build:** A README documenting environment setup and usage, accurate to the finished pipeline, so a reviewer can run it themselves against the sample documents.

**Blocked by:** 04, 05, 06

**Status:** ready-for-human

- [x] Following the README's setup instructions from a fresh clone (installing dependencies, configuring `.env` (maybe we should create .env-todo or something of the sort with suggested values for the known keys), provisioning Postgres) results in a working local environment.
- [x] Following the README's usage instructions to run the CLI against `sample-input/` produces `so`/`po` records in Postgres, matching the behavior described in the README.
- [x] The README documents the `needs_review` status and what it means for a document that didn't fully extract.

## Comments

Rewrote `README.md` with Setup (`npm install`, `cp .env.example .env` + fill in
`ANTHROPIC_API_KEY`, `npm run db:up`), Usage (`npm run pipeline [inputDir]`, sample
output, table routing including `unclassified_documents`, a `psql` snippet for
inspecting results), a dedicated `needs_review` status section, and Testing (what each
of `test:unit`/`test:pipeline`/`test:eval` covers, calling out that `test:eval` makes
live billed Anthropic API calls). Kept the existing Local Postgres and Model selection
content, folding the former into Setup.

Added `.env.example` (the `.env-todo` idea from the checklist) with all 4 known keys —
`ANTHROPIC_API_KEY` blank for the reviewer to fill in, `ANTHROPIC_MODEL`/`DATABASE_URL`/
`TEST_DATABASE_URL` pre-filled with working values matching what `npm run db:up`
provisions. `.gitignore` already special-cased `!.env.example` ahead of this issue.

Verified setup + usage instructions for real: ran `npm run pipeline` against
`sample-input/` (all 4 sample docs) — produced 2 `so` and 2 `po` rows, all `processed` —
then ran the exact `psql` verification command from the README against the `so` table
and confirmed it returns the expected rows. Also ran `typecheck`, `lint`, `test:unit`,
and `test:pipeline` (all passing) as a sanity check, since no source code changed.
