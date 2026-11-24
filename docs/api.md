# REST API

All routes start at `/api`. Send JSON with `Content-Type: application/json` unless the endpoint uses multipart. Browser writes use the configured `APP_ORIGIN`. Non-browser clients must supply that exact origin, retain the session cookie returned at login, and send it on staff requests.

| Method and path | Role | Request or response |
| --- | --- | --- |
| POST `/auth/login` | Public | `email`, `password`. Returns role and session cookie. |
| GET `/auth/me` | Staff | Current user and institution details. |
| POST `/auth/logout` | Any | Destroys the session and returns 204. |
| GET `/dashboard` | Staff | Scoped counts, contract address and issuer approval for institution staff. |
| GET / POST `/admin/institutions` | Admin | List institutions, live approval and local wallet choices. Create with `name`, `wallet`. |
| PATCH `/admin/institutions/:id` | Admin | `enabled` boolean, applies on-chain approval or disabling. |
| GET / POST `/admin/users` | Admin | List or create using `email`, `password`, `role` and `institution` ID string for issuers. |
| PATCH `/admin/users/:id` | Admin | `enabled` boolean. Disabling deletes active sessions. |
| GET `/admin/activity` | Admin | Up to 200 latest audit and verification events. |
| GET `/certificates?page=1` | Staff | 25 scoped records with transaction hash, synchronization state and revocation status. |
| POST `/certificates` | Issuer | Multipart fields `id` (optional), `holder`, `qualification`, `file` (PDF). |
| POST `/certificates/:id/synchronize` | Staff | Confirm an existing pending record. Its own institution officer can retry a recoverable registration. |
| POST `/certificates/:id/revoke` | Staff | Admin or approved original issuer revokes a certificate. |
| GET `/certificates/:id/qr` | Staff | PNG encoding the public verification URL for a confirmed scoped certificate. |
| POST `/verify` | Public | JSON `id` for a lookup, or multipart `id` and `file` for an integrity check. |

Approved on-chain state is required for issuance and enabled issuer revocation. IDs use three to 64 uppercase letters, digits and hyphens after normalization, with a letter or digit first. The upload size limit is 5 MiB. Correctly formed verification requests return `registered`, `match`, `mismatch`, `revoked`, `not_found`, or `issuer_disabled` with HTTP 200. `unavailable` uses HTTP 503. Where available, the response also provides the public institution name, issuer address, network and registration transaction. Local registration returns 201 on confirmation. Sepolia returns 202 after saving the broadcast hash, and the staff UI periodically calls synchronization with `?check=1` to check for confirmation without submitting a transaction. Approval and revocation return 200 on confirmation or 202 with the known broadcast hash if pending.

Other errors use `{"error":"message"}`. Typical status codes are 400 for malformed inputs, 401 for an absent or invalid session, 403 for role or approval restrictions, 404 for an unavailable staff record, 409 for duplicates or concurrent registry writes, 429 for rate limiting and 503 for unavailable dependencies.
