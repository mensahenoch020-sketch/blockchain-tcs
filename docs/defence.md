# Project defence guide

## Preparation

- Start PostgreSQL, Hardhat, and the web application using the README. Generate the fictional fixtures before the presentation.
- Have the administrator and institution credentials at hand. Leave the demo institution unapproved if you plan to show the approval action live.
- Use a new ID if rehearsals already registered `TCS-DEMO-001`. The printed sample shows the default ID, so use a fresh registry for the cleanest live demonstration.
- Keep Hardhat running throughout. Use the built app and a reachable QR origin if you plan to scan with a second device.

## Presentation sequence

1. Introduce the problem of confirming academic credentials and detecting changes to distributed digital files. Show the architecture. Explain that Ethereum holds the digest and issuer status, while PostgreSQL holds staff accounts and the private PDF.
2. Sign in as administrator. Open **Institutions** and approve the demo issuer. Point out that the transaction updates authorization in the Solidity contract.
3. Sign in as the institution officer. Register the original certificate fixture. Record the certificate ID and transaction hash after confirmation.
4. Open the QR link in a private browser window. Show **Registered · Active** with the ID lookup. Upload `original.pdf` and show **Verified File Match**. Repeat with `exact-copy.pdf`.
5. Upload `modified.pdf` and show **Document Mismatch**. Explain that editing or rescanning can change the bytes. Look up an unknown ID and show **Not Found**.
6. Return to the institution’s records and revoke the certificate. Verify using the original PDF again and show **Revoked**. Sign in as administrator to show the activity history.
7. Summarize the test results and the separate Sepolia setup. Explain that the platform depends on approved institutions to issue truthful academic records.

## Explaining the technology

- **SHA-256** is a deterministic digital fingerprint of the full file. The exact same bytes always produce the same fingerprint.
- **Ethereum** executes the contract rules and keeps the transaction history. The contract checks the issuing wallet every time a certificate is registered.
- **PostgreSQL** links the official record and its private PDF to the on-chain registration. Its staging row lets the API recover from a failure between blockchain confirmation and database finalization.
- **The QR code** encodes a public verification URL with the certificate ID. An uploaded PDF is needed to establish an exact file match.
