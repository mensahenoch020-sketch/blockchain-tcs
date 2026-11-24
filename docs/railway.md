# Railway deployment

Railway runs the Express API and the compiled React frontend in one service, with PostgreSQL as a second service. Ethereum transactions go to Sepolia. The Dockerfile compiles the Solidity ABI and builds the frontend before producing a Node runtime image. Railway runs database migrations and seeds the first administrator before starting the app.

## Configure the services

1. Deploy the registry once from your own machine using the [Sepolia guide](sepolia.md), through the `npm run deploy:sepolia` step. Keep the resulting `contracts/deployments/11155111.json` file.
2. Create a Railway project with a PostgreSQL service and a GitHub service for the repository, using the repository root and the `main` branch. Generate a public domain for the application service.
3. Set the following variables on the application service. Substitute the actual PostgreSQL service name if it differs from `Postgres`.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_ORIGIN` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` or the full HTTPS origin of your custom domain |
| `COOKIE_SECURE` | `true` |
| `CHAIN_ID` | `11155111` |
| `CONFIRMATIONS` | `2` |
| `RPC_URL` | Sepolia HTTPS RPC URL |
| `REGISTRY_DEPLOYMENT_JSON` | The contents of `contracts/deployments/11155111.json` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The bootstrap administrator credentials |
| `ADMIN_PRIVATE_KEY` | The key for the funded Sepolia wallet that deployed the registry |
| `ISSUER_PRIVATE_KEYS` | Comma-separated keys for funded Sepolia issuer wallets |

Leave `PORT` to Railway and leave `DEMO_ISSUER_PASSWORD` unset. Enter keys and passwords directly in Railway's service variables. The registry deployment JSON contains public metadata and no signing keys. The bootstrap password is used when creating the administrator account, so changing it later in Railway does not reset the account password.

4. Deploy and check that `GET /health` returns `{"status":"ready"}`. A 503 indicates that PostgreSQL or the configured registry is unavailable. Once ready, sign in as the administrator, add and approve an institution with a configured issuer wallet, and create its officer. Issue a fictional PDF, open its transaction in Sepolia Etherscan, and open the QR link on a phone.

The Dockerfile also runs locally. The hosted deployment requires access to the intended Railway workspace and the Sepolia configuration described above.
