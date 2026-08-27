# safebooks

safebooks full stack developer take home assignment

## Local Postgres

`npm run db:up` starts a `postgres:18` container (`safebooks-pg`, port 5432) with two databases: `safebooks` (app) and `safebooks_test` (test suite). `npm run db:down` stops it; data persists in the `safebooks-pg-data` volume across restarts.

On macOS, this requires a running Docker daemon — via [colima](https://github.com/abiosoft/colima) (`colima start`) or Docker Desktop. `npm run db:up` checks `docker info` and fails with a hint if nothing is reachable.

`DATABASE_URL` / `TEST_DATABASE_URL` in `.env` point at these databases; the pipeline and test suite read them from there.

Full setup/usage instructions land with the README ticket (issue 07).
