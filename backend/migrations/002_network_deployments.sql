CREATE TABLE network_deployments (
  chain_id integer PRIMARY KEY,
  administrator text NOT NULL,
  deployment_id text NOT NULL,
  signed_transaction text NOT NULL,
  metadata jsonb
);
