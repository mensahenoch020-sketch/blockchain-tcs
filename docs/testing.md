# Tests and observed results

The application was tested with Node.js 24.22.3, PostgreSQL 16 in Docker, Hardhat's local EVM, and headless Chromium. The integration suite used real PostgreSQL queries and Ethereum transactions. The RPC outage test interrupted access using an HTTP proxy, and the database failure test used a PostgreSQL trigger to reject the final write.

## Reproduce the automated checks

Run the README setup first, keeping the Hardhat node running. The API test starts its own server on a dynamically assigned port. Use a separate disposable database and avoid running the browser and API suites concurrently on the same chain.

```bash
npm test
npm run build

docker exec tcs-postgres createdb -U postgres credentials_test
export TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/credentials_test

npm run test:api
npx playwright install chromium
npm run test:browser
```

Set `CHROMIUM_PATH` if using an existing Chromium installation instead of Playwright’s bundled browser. The automated workflow uses a disposable local chain, synthetic records and random test credentials. The tests write actual test records and disable their test issuer wallets during cleanup. The build and contract suite can run without PostgreSQL.

## Results

| Command | Observed result |
| --- | --- |
| `npm test` | 5 Solidity tests passed |
| `npm run test:api` | 10 integration scenarios passed, with 11 passing TAP entries including the parent test |
| `npm run test:browser` | 1 Chromium workflow passed, covering desktop staff actions and anonymous verification at a 390 px mobile viewport |
| `npm run build` | Production build succeeded |
| `npm run fixtures` | Created the original, exact copy and edited sample PDFs |

The initial browser run found that the institution selector could not be located by its exact accessible label. The selector was given an explicit accessible name and the browser workflow passed on rerun.

| Chapter Three case | Observed automation outcome |
| --- | --- |
| TC01 Approved issuer | API returned confirmed and Ethereum returned a successful transaction receipt. |
| TC02 Unapproved issuer | Contract and API rejected attempts to register. The API also rejected public and administrator issuance requests. |
| TC03 Original file | Original and byte-for-byte copy both returned Verified File Match. An ID-only lookup returned Registered · Active. |
| TC04 Modified file | A valid edited PDF returned Document Mismatch. |
| TC05 Unknown ID | Returned Not Found. |
| TC06 Revoked certificate | Revoked took precedence for both matching and mismatching files. The original approved issuer and the administrator revocation paths were exercised. |
| TC07 Duplicate | Contract and API both rejected duplicate IDs. |
| TC08 Blockchain interruption | The API returned Unable to Verify during an RPC outage. With mining disabled, it reported a pending transaction, then synchronized it after mining. |
| TC09 Invalid upload | Non-PDF MIME, malformed PDF, and missing fields produced validation errors. |
| Additional account checks | Wrong password, incorrect request origin, forbidden approval, disabled issuer, invalidated user session, and logout were covered. |
| Additional database check | Finalization failure returned a service error. Synchronization recovered the confirmed transaction from Ethereum even after clearing its saved hash. |
| Additional QR check | The PNG was decoded and its exact verification URL matched the expected certificate ID. The QR image and its link also loaded in Chromium. |

The seven explicit public verification assertions in the exact-file and revocation scenarios produced their expected categories: ID-only, original, byte-for-byte copy, edited PDF, unknown ID, and two revoked-file checks. Operational scenarios also tested pending, disabled-issuer and outage responses. These are controlled fictional cases. No production-scale accuracy, usability study, latency benchmark, or Sepolia test result is claimed.

## Manual rehearsal

| Step | Expected outcome |
| --- | --- |
| Follow the [defence guide](defence.md) as an administrator, issuer and anonymous verifier. | Each account sees its own controls and the public page requires no login. |
| Open a QR link on a second device using a reachable application origin. | The correct ID is prefilled and registration status is displayed. |
| Compare the three fixture PDFs. | Original and exact copy match, edited PDF differs. |
| Upload a text file or an oversized file. | The form/API reports the permitted file type and size. |
| Stop the local RPC after an issued record is visible. | Public verification reports Unable to Verify. Restore or redeploy the registry before continuing. |
| Revoke on a running chain, then repeat the original upload. | Revoked is shown and an audit entry is present. |
| Review layout at laptop, tablet and phone widths. | Navigation and forms remain usable, and large staff tables can scroll independently. |

Physical camera scanning and Sepolia deployment are manual follow-up checks. The automated browser test opened the real QR-linked route and the API test separately decoded the generated QR payload.
