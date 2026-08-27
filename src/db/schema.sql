CREATE TABLE IF NOT EXISTS so (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  start_date TEXT,
  end_date TEXT,
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

CREATE TABLE IF NOT EXISTS po (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  start_date TEXT,
  end_date TEXT,
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
