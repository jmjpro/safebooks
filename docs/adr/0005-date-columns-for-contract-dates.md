# DATE columns for start_date/end_date, not TEXT

`so.start_date`, `so.end_date`, `po.start_date`, and `po.end_date` were originally `TEXT`, holding whatever `"mm-dd-yyyy"` string `AnthropicFieldExtractor` produced. That only "worked" because the extractor's regex validated every extracted value's shape before assigning it, so the column only ever held `NULL` or an `"mm-dd-yyyy"` string — never garbage.

Two problems with `TEXT` don't go away just because the shape is validated. `"mm-dd-yyyy"` text doesn't sort or range-query chronologically — `"01-15-2026" < "12-01-2025"` as strings, even though the first date is later — which matters for anything SafeBooks will likely need (contract terms expiring soon, burst-period overlap). And a shape-only regex doesn't check calendar validity: `"02-30-2025"` and `"13-01-2025"` both match `\d{2}-\d{2}-\d{4}$`, but neither is a real date.

We changed the columns to `DATE` and extended the extractor's validation (`isValidMmDdYyyyDate` in `src/shared/date.ts`) to reject calendar-invalid values the same way it already rejects shape-invalid ones — via `fieldErrors`, routing the document to `needs_review` rather than persisting a bad date or crashing the insert. The repositories convert the extractor's validated `"mm-dd-yyyy"` string to ISO `"yyyy-mm-dd"` before binding it as a query parameter.

Reading `DATE` columns back also needed a type-parser override (`src/db/date-type-parser.ts`): `pg`'s default `DATE` parser builds a local-timezone JS `Date`, which shifts the calendar day when read back east of UTC. Since a `DATE` column has no time-of-day or timezone component, we register it to come back as the plain `"yyyy-mm-dd"` string Postgres sends instead.
