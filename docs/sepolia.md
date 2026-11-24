# Ethereum Sepolia deployment

You need an Ethereum Sepolia HTTPS RPC endpoint and separate wallets for the registry administrator and each issuing institution. Obtain test ETH for gas on each signing wallet. Record issuer addresses before deploying so you can associate them with institutions in the admin dashboard.

1. Install the project and set up a private PostgreSQL database. Use an application database account with a password and database TLS where appropriate.
2. Using `.env.example`, set `CHAIN_ID=11155111`, `CONFIRMATIONS=2`, `LOCAL_UNLOCKED_SIGNERS=false`, and assign the Sepolia HTTPS URL to both `SEPOLIA_RPC_URL` and `RPC_URL`.
3. Set `ADMIN_PRIVATE_KEY` to the administrator’s test wallet key and `ISSUER_PRIVATE_KEYS` to a comma-separated list of the test issuer wallet keys. The deployment script uses the administrator key, and the API selects a configured issuer key by matching the institution’s address.
4. Configure `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Leave `DEMO_ISSUER_PASSWORD` blank. Configure the web origin and secure cookie setting for the HTTPS deployment.
5. Run `npm run deploy:sepolia`, then `npm run db` and `npm run build`. Start `npm run api` behind an HTTPS reverse proxy that preserves the original browser origin.
6. Sign in as admin, create an institution with one of the configured issuer addresses, approve it, and create an institution officer account. Sign in as that officer, issue a fictional certificate, and follow its transaction link to Sepolia Etherscan. Inspect the transaction hash and registration event.
7. Use the verification page with and without the original PDF, then revoke and verify again. Use the activity log or the explorer to check approval and revocation transaction references.

Sepolia deployment is configured but was not executed. A working Sepolia RPC endpoint and funded test wallets were unavailable. The local demonstration uses real EVM transactions without requiring funds or external services.
