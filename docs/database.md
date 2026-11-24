# PostgreSQL schema

Run `npm run db` to apply SQL migrations and optionally seed users from `.env`. The migration runner records applied migration names and uses a transactional advisory lock to prevent concurrent setup.

| Relation | Keys and purpose |
| --- | --- |
| `institutions` | Identity primary key, unique name and unique lower-case Ethereum wallet. Approval is read from Ethereum. |
| `users` | Identity primary key, unique normalized email, scrypt password hash, role, and access flag. Issuers reference their institution. Administrators have no institution. |
| `certificates` | Composite primary key of registry identity and normalized certificate ID. References an institution. Stores holder, qualification, SHA-256 digest, protected PDF bytes, staging block, registration transaction hash and synchronization state. |
| `sessions` | SHA-256 token hash as the primary key, user foreign key, and expiry timestamp. |
| `activity_logs` | Identity primary key, optional staff actor, action, subject, detail, and timestamp. Public verification events use a null actor. |
| `schema_migrations` | Tracks applied migration files. |

The `(registry, id)` key prevents duplicate certificates within a deployment. Registry identity incorporates the chain ID and deployment transaction. The PDF is a private `bytea` object referenced by the certificate row’s primary key. Keeping it in the same database avoids orphan files after a partially completed write. The browser and public API have no access to this column.

`pending` means staged or awaiting reconciliation, `confirmed` means the registration is confirmed and synchronized, and `failed` records a confirmed failed registration or incompatible on-chain evidence. Revocation and approval are separate live contract properties. Audit events record privileged write requests, known approval or revocation submissions, observed confirmations, and public verification categories.
