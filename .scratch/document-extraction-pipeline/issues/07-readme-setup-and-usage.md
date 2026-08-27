# 07: README: setup and usage

**What to build:** A README documenting environment setup and usage, accurate to the finished pipeline, so a reviewer can run it themselves against the sample documents.

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [ ] Following the README's setup instructions from a fresh clone (installing dependencies, configuring `.env` (maybe we should create .env-todo or something of the sort with suggested values for the known keys), provisioning Postgres) results in a working local environment.
- [ ] Following the README's usage instructions to run the CLI against `sample-input/` produces `so`/`po` records in Postgres, matching the behavior described in the README.
- [ ] The README documents the `needs_review` status and what it means for a document that didn't fully extract.
