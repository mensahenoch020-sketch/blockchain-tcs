# Railway deployment

Railway runs the Express API and the compiled React frontend in one service, with PostgreSQL as a second service. Ethereum transactions go to Sepolia. The Dockerfile compiles the Solidity ABI and builds the frontend before producing a Node runtime image. Railway runs database migrations and seeds the first administrator before starting the app.

## Configure the services

1. Create a Railway project with a PostgreSQL service and a GitHub service for this repository. Use the repository root and the `main` branch. Generate a public domain with target port 3000.
2. Prepare a Sepolia RPC endpoint and fund a dedicated administrator test wallet. The pre-deploy command will create the contract and record its transaction and deployment metadata in PostgreSQL. Future deploys reuse the saved contract.
3. Set the following variables on the application service. Substitute the actual PostgreSQL service name if it differs from `Postgres`.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_ORIGIN` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` or the full HTTPS origin of your custom domain |
| `COOKIE_SECURE` | `true` |
| `PORT` | `3000` |
| `AUTO_DEPLOY_SEPOLIA` | `true` |
| `CHAIN_ID` | `11155111` (default in automatic mode) |
| `CONFIRMATIONS` | `2` |
| `RPC_URL` | Sepolia HTTPS RPC URL |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The bootstrap administrator credentials |
| `ADMIN_PRIVATE_KEY` | The key for the funded Sepolia administrator test wallet |
| `ISSUER_PRIVATE_KEYS` | Comma-separated keys for funded Sepolia issuer wallets |

Leave `DEMO_ISSUER_PASSWORD` unset. Enter keys and passwords directly in Railway's service variables. The registry deployment JSON contains public metadata and no signing keys. The bootstrap password is used when creating the administrator account, so changing it later in Railway does not reset the account password.

4. Deploy and check that `GET /health` returns `{"status":"ready"}`. A 503 indicates that PostgreSQL or the configured registry is unavailable. Once ready, sign in as the administrator, add and approve an institution with a configured issuer wallet, and create its officer. Issue a fictional PDF, open its transaction in Sepolia Etherscan, and open the QR link on a phone.

The Dockerfile also runs locally. The hosted deployment requires access to the intended Railway workspace and the Sepolia configuration described above.

For an existing registry, provide its `REGISTRY_DEPLOYMENT_JSON` and set `CHAIN_ID=11155111`. A supplied deployment JSON takes precedence over automatic deployment. Keep the same PostgreSQL database across redeploys so the app can reuse its recorded registry.
