-- start_date/end_date are DATE, not TEXT: "mm-dd-yyyy" text sorts lexicographically rather
-- than chronologically, and TEXT can't reject an invalid calendar date the extractor's regex
-- lets through (e.g. "02-30-2025"). See ADR 0005.
CREATE TABLE IF NOT EXISTS so (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  start_date DATE,
  end_date DATE,
  amount NUMERIC,
  payment_terms TEXT,
  billing_address TEXT,
  customer_signature BOOLEAN,
  burst TEXT,
  technical_account_manager TEXT,
  status TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS so_items (
  id SERIAL PRIMARY KEY,
  so_id INTEGER NOT NULL REFERENCES so (id) ON DELETE CASCADE,
  product_name TEXT,
  quantity NUMERIC,
  price NUMERIC,
  total_amount NUMERIC
);

-- start_date/end_date are DATE, not TEXT — same rationale as so.start_date above (ADR 0005).
CREATE TABLE IF NOT EXISTS po (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  start_date DATE,
  end_date DATE,
  amount NUMERIC,
  payment_terms TEXT,
  billing_address TEXT,
  customer_signature BOOLEAN,
  burst TEXT,
  technical_account_manager TEXT,
  status TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS po_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES po (id) ON DELETE CASCADE,
  product_name TEXT,
  quantity NUMERIC,
  price NUMERIC,
  total_amount NUMERIC
);

-- Holds a Document the extractor couldn't classify as an Order Form or a Purchase Order.
-- Not force-fit into so/po (per ADR 0001, those tables are for classified records only) —
-- see ADR 0006. Always status = 'needs_review': an unclassifiable document is never
-- "processed" regardless of whether its individual fields happened to extract cleanly.
CREATE TABLE IF NOT EXISTS unclassified_documents (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  start_date DATE,
  end_date DATE,
  amount NUMERIC,
  payment_terms TEXT,
  billing_address TEXT,
  customer_signature BOOLEAN,
  burst TEXT,
  technical_account_manager TEXT,
  status TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration for databases created before ADR 0005: CREATE TABLE IF NOT EXISTS above won't
-- retype so/po's start_date/end_date on a table that already exists, so retype them here.
-- Postgres's default DateStyle ("ISO, MDY") reads the existing "mm-dd-yyyy" text correctly.
-- A no-op once the columns are already DATE.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'so' AND column_name = 'start_date' AND data_type = 'text'
  ) THEN
    ALTER TABLE so ALTER COLUMN start_date TYPE DATE USING start_date::date;
    ALTER TABLE so ALTER COLUMN end_date TYPE DATE USING end_date::date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'po' AND column_name = 'start_date' AND data_type = 'text'
  ) THEN
    ALTER TABLE po ALTER COLUMN start_date TYPE DATE USING start_date::date;
    ALTER TABLE po ALTER COLUMN end_date TYPE DATE USING end_date::date;
  END IF;
END $$;
