CREATE TABLE institutions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  wallet text NOT NULL UNIQUE CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id bigint REFERENCES institutions(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'issuer')),
  enabled boolean NOT NULL DEFAULT true,
  CHECK ((role = 'issuer') = (institution_id IS NOT NULL))
);

CREATE TABLE certificates (
  id text NOT NULL,
  registry text NOT NULL,
  institution_id bigint NOT NULL REFERENCES institutions(id),
  holder text NOT NULL,
  qualification text NOT NULL,
  digest text NOT NULL,
  document bytea NOT NULL,
  start_block integer NOT NULL,
  tx_hash text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'confirmed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registry, id)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE activity_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id bigint REFERENCES users(id),
  action text NOT NULL,
  subject text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX certificates_institution_idx ON certificates(registry, institution_id);
CREATE INDEX activity_created_idx ON activity_logs(created_at DESC);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
