# RepoFit Comments security model

Status: 1.1.0-alpha.1 multi-language technical security boundary

Date: 2026-09-06

## Assets

RepoFit protects four things during automatic comment cleanup:

1. non-comment source tokens and parsed syntax structure;
2. comments classified as legal, tooling, API, security, compatibility, rationale, or another protected category;
3. user edits made before or during the replacement transaction;
4. private source bytes stored for local recovery.

## Trusted boundary

RepoFit assumes the operating-system account running the CLI controls both the working tree and its `.git` directory. Receipts defend against accidental corruption, stale state, interrupted processes, ordinary concurrent edits, and untrusted repository content. They are **not cryptographically authenticated evidence against a malicious process running as the same OS user**.

A same-user attacker able to rewrite the repository, `.git/repofit-comments/`, and the RepoFit executable can forge local state. The current product therefore must not market a receipt as a tamper-proof compliance attestation. A future team audit product would require an external trust anchor, append-only remote log, hardware-backed key, or equivalent design.

## Analysis boundary

- Analysis is local and sends no source, paths, findings, or telemetry over the network.
- Git subprocesses disable external diff, textconv, fsmonitor, replace objects, lazy fetch, prompts, optional locks, and pagers; dangerous Git environment injection is removed.
- RepoFit never executes target-repository scripts or loads executable project configuration.
- Invalid UTF-8, unsafe path resolution, final symlinks, parent symlink/junction escapes, and multiple-hard-link source files are refused.
- Generated and vendored files are protected at whole-file scope.
- TypeScript/JavaScript analysis uses the TypeScript parser. Other automatic-fix languages use locally installed Tree-sitter WASM grammars; Shell uses the current standalone Bash grammar because the legacy bundle's dynamic-linking format failed the live multi-file gate. Grammar load or parse failure prevents automatic writing.
- Node 24 CLI and test entry points use V8's Liftoff-only WASM mode. The initial remote matrix reproduced a V8 `Fatal process out of memory: Zone` while exercising all grammars concurrently; the launcher contains the flag within RepoFit's child process, and the subsequent six-combination matrix passed.
- Vue and Svelte automatic writes are confined to JavaScript/TypeScript `<script>` regions; markup comments are protected. SQL is scan-and-review only and cannot enter the write transaction.

## Write transaction

Only `fix --worktree --apply` can change source.

1. RepoFit obtains one repository-wide write lock.
2. It validates the current bytes, mode, finding snapshot, parser state, tokens, syntax tree, and protected comments.
3. It writes and synchronizes a private byte-exact backup.
4. It writes a `prepared` journal.
5. It prepares and synchronizes the candidate in the source directory.
6. It renames the current source to a receipt-bound displaced path, verifies the captured bytes, and uses a hard link to install the candidate only if the destination is still absent.
7. It verifies the installed bytes and mode, removes the displaced copy, synchronizes the directory, and records `applied`.

If an interruption leaves a known intermediate state, `recover` compares the source and transaction artifacts with the two receipt-bound byte hashes before moving the journal to `applied`, `aborted`, or `undone`. `verify` never treats `prepared` or `undo-prepared` as success.

`undo` restores only an `applied` receipt. Before writing, it rechecks the current file and independently proves that the backup has the same non-comment tokens, syntax tree, and protected-comment hash. It never modifies the Git index.

## Concurrency boundary

The repository-wide lock prevents two RepoFit writers from interleaving. The no-clobber transaction also detects and preserves ordinary edits that replace or rewrite the source path immediately before installation.

The no-clobber design deliberately has a brief interval between displacement and installation in which a concurrent reader can observe the source path as missing. It is a recoverable transaction, not an atomic rename. No user-space CLI can guarantee safety against every adversarial writer holding an already-open file descriptor and writing after the final verification point. Users must not intentionally edit the same file during the sub-second apply/undo transaction. RepoFit does not claim arbitrary-writer serializability.

## Filesystem metadata boundary

The current implementation preserves exact source bytes and the low POSIX permission bits, and refuses source files with multiple hard links. It does not yet prove preservation of ACLs, extended attributes, ownership, Windows DACLs, macOS metadata, network-filesystem semantics, or every antivirus/file-indexer interaction.

Automatic writes are enabled only on POSIX in this RC. Windows remains read-only until DACL privacy, no-clobber replacement, recovery, and metadata fixtures pass; the configured Windows matrix must prove both read-only behavior and explicit write refusal.

## Recovery-data privacy

Backups can contain proprietary code, secrets, or comments that the user later removes from the working tree. They live under `.git/repofit-comments/backups/`, are never staged by Git, and use enforced private modes on POSIX. Windows DACL privacy remains unverified, so these files must still be treated as sensitive local data on every platform.

Admission of a new automatic write fails closed when one backup would exceed 2 MiB, history reaches 200 receipts, or total recovery data would exceed 64 MiB. A previously admitted receipt may still transition during undo/recovery even when storage is later filled, so quota enforcement does not strand an interrupted journal. `history list` exposes the bounded store. `history prune` previews by default, never selects the latest or a non-terminal journal, moves paired receipt/backup files behind a durable marker before deletion, and resumes interrupted pruning before starting new work. Users who manually delete recovery data outside that workflow accept that the corresponding fix can no longer be undone.

Schema 2 Alpha receipts had no byte-exact backup and therefore cannot support safe undo. The next schema 3 write tightens the POSIX data-directory mode, preserves the old receipt under `legacy/`, and starts repository-bound recoverable history without treating the old receipt as schema 3 evidence.

## Output and CI boundary

- Human output escapes terminal control, OSC, zero-width, and bidirectional formatting characters controlled by a repository.
- JSON errors are versioned and go to stderr.
- Receipt JSON never includes backup bytes.
- npm provenance and GitHub artifact attestations prove build origin; they do not prove source correctness or runtime safety.

## Security reporting

Follow [SECURITY.md](../SECURITY.md). Reports should use the smallest non-sensitive reproduction and must not attach private repositories, credentials, or production data.
