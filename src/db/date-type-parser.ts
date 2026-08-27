import { types } from 'pg'

const DATE_OID = 1082

// pg's default DATE parser builds a local-timezone JS Date, which can shift the calendar
// day when read back east of UTC (local midnight -> previous-day UTC via toISOString()).
// A DATE column has no time-of-day or timezone component, so keep it as the plain
// "yyyy-mm-dd" string Postgres actually sends instead of round-tripping it through a
// timezone-sensitive Date.
types.setTypeParser(DATE_OID, (value) => value)
