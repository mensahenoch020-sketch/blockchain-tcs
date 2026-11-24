# Blockchain-Based Academic Certificate Verification and Tamper Detection

Credential Registry is a final-year Telecommunication Science project based on Chapters One through Three of the supplied University of Ilorin project document. An approved institution registers a PDF’s SHA-256 digest on Ethereum. Anyone can look up the certificate ID or open its QR link and optionally check the exact bytes of a PDF.

## Run the local demonstration

Requirements are Node.js 22.12 or later, npm, Docker or a PostgreSQL 16 instance, and three terminals. Run the commands from the repository root.

```bash
npm ci
cp .env.example .env
npm run fixtures
docker run -d --name tcs-postgres \
  -e POSTGRES_DB=credentials -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1:55432:5432 -v tcs-postgres-data:/var/lib/postgresql/data postgres:16
```

Set your own distinct passwords of at least 12 characters for `ADMIN_PASSWORD` and `DEMO_ISSUER_PASSWORD` in `.env`. The default demo account addresses are `admin@example.test` and `issuer@example.test`. The database command will seed those accounts and a demo institution. The local trust-mode database should stay on loopback. If using an existing PostgreSQL instance, create a database and update `DATABASE_URL`.

In terminal 1, start Hardhat and leave it running.

```bash
npm run chain
```

In terminal 2, deploy the registry, migrate and seed the database, then start the API.

```bash
npm run deploy
npm run db
npm run api
```

In terminal 3, start the Vite UI. Open **http://localhost:5173** exactly as configured in `APP_ORIGIN`.

```bash
npm run dev
```

Sign in as the administrator, open **Institutions**, and approve **University of Ilorin · Demo**. Sign out and sign in as the issuer. Register `fixtures/original.pdf` with ID `TCS-DEMO-001`, holder `Sample Graduate`, and qualification `B.Sc. Telecommunication Science`. The record will show a real Hardhat transaction hash. Use **Certificates** to open the QR verification link, then check the original, the exact copy, and the modified PDF.

### Serve the built UI with Express

Run `npm run build`, set `APP_ORIGIN=http://localhost:3000` in `.env`, restart the API, and open **http://localhost:3000**. Refreshing any app route works on this origin. Set `APP_ORIGIN` to the actual browser URL before sharing QR links. A phone camera can scan the QR, but a loopback URL only opens on the machine running the app. For an isolated LAN demo, serve the build with `BIND_HOST=0.0.0.0` and set `APP_ORIGIN` to the computer’s LAN address and port. Keep the RPC and database on loopback and use fictional data on HTTP.

### Restarting the demo

The local Hardhat node uses an in-memory chain. Keep it running during a demonstration. After a restart, run `npm run deploy` and restart the API. The fresh registry has a new deployment identity, so old registry rows are excluded from the current certificate history even if the contract address repeats. Approve the demo issuer again and issue a new record. The setup command applies migrations idempotently and leaves existing password hashes in place.

## Project directory

| Directory | Contents |
| --- | --- |
| `frontend/` | React, Vite and Tailwind CSS UI for public verification and the two staff roles |
| `backend/` | Express application, validation, authentication, transaction handling and SQL migrations |
| `contracts/` | Solidity contract, Hardhat configuration, deployment script and contract tests |
| `fixtures/` | Generator for fictional original, byte-for-byte copy, and modified PDFs |
| `docs/` | Architecture, schema, API, contract, Sepolia, testing and defence guides |

Node.js 24 was used for local verification. `package-lock.json` pins the packages for reproducible installs. The underlying major versions include React 19, Vite 7, Tailwind 4, Express 5, Ethers 6, PostgreSQL 16 and Hardhat 2 with Solidity 0.8.28.

- [Architecture and Chapter Three traceability](docs/architecture.md)
- [Database schema](docs/database.md)
- [API reference](docs/api.md)
- [Smart contract](docs/contract.md)
- [Ethereum Sepolia setup](docs/sepolia.md)
- [Railway hosting](docs/railway.md)
- [Test procedures and results](docs/testing.md)
- [Project defence guide](docs/defence.md)
