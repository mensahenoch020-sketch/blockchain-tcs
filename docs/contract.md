# Ethereum certificate registry

Location: `contracts/contracts/CertificateRegistry.sol`. The deployer is the immutable administrator. An immutable random deployment ID lets the API recognize the correct registry when a local network restarts.

| Function or getter | Behaviour |
| --- | --- |
| `setIssuer(address,bool)` | Administrator approves or disables a nonzero issuer wallet and emits `IssuerApproval`. |
| `register(bytes32,bytes32)` | Approved issuer supplies the ID lookup key and exact PDF’s SHA-256 digest. Rejects zero values and duplicates, sets the block timestamp, stores the caller as issuer, and emits `Registered`. |
| `certificates(bytes32)` | Read digest, issuer, issuance timestamp and revocation flag. A zero issuer denotes an absent record. |
| `approved(address)` | Read whether a wallet is currently authorized to issue. |
| `revoke(bytes32)` | Administrator or the currently approved original issuer permanently revokes an existing active certificate and emits `Revoked`. |

The backend normalizes IDs by trimming and converting them to uppercase, then applies Ethereum’s Keccak-256 ID function to form the contract’s mapping key. The value checked for document integrity is SHA-256 from the complete uploaded byte sequence. The roles and the immutable registry protect against unauthorized changes to these records. Institution names, student details, passwords and complete PDFs stay off-chain. Anyone who knows an ID can derive its public lookup key, so this transformation provides no confidentiality for predictable IDs.

The app waits one confirmation locally and defaults to two on Sepolia. A block confirmation shows inclusion in the currently observed chain. The deployment script saves the chain ID, contract address, deployment block, transaction hash and deployment identity in an ignored local JSON file. Contract history provides a second source for reconciling pending PostgreSQL entries.
