# safebooks

safebooks full stack developer take home assignment

## Local Postgres

`npm run db:up` starts a `postgres:18` container (`safebooks-pg`, port 5432) with two databases: `safebooks` (app) and `safebooks_test` (test suite). `npm run db:down` stops it; data persists in the `safebooks-pg-data` volume across restarts.

On macOS, this requires a running Docker daemon — via [colima](https://github.com/abiosoft/colima) (`colima start`) or Docker Desktop. `npm run db:up` checks `docker info` and fails with a hint if nothing is reachable.

`DATABASE_URL` / `TEST_DATABASE_URL` in `.env` point at these databases; the pipeline and test suite read them from there.

## Model selection

`ANTHROPIC_MODEL` in `.env` selects which Claude model `AnthropicFieldExtractor` uses (defaults to `claude-haiku-4-5` if unset). Override it to compare models — no code changes needed:

```
ANTHROPIC_MODEL=claude-sonnet-5 npm run pipeline
```

`claude-haiku-4-5` is the default per the comparison in issue 01.5 (`.scratch/document-extraction-pipeline/issues/01.5-model-comparison-haiku-sonnet-opus.md`): against the 4 sample documents it matched `claude-opus-5`'s field-level accuracy while running faster and at roughly a fifth of the cost. `npm run compare-models` re-runs that comparison (extraction only, no persistence) against whatever model `ANTHROPIC_MODEL` currently points at.

Full setup/usage instructions land with the README ticket (issue 07).
