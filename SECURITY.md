# Security policy

RepoFit rewrites source files, so incorrect path handling or comment classification can be security-relevant.

The supported trust assumptions, write transaction, concurrency limits, filesystem metadata limits, and recovery-data privacy model are documented in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).

Please avoid public issues for vulnerabilities. Use the repository's private GitHub security-advisory form when available and include the smallest non-sensitive reproduction you can. Never attach proprietary repositories, credentials, tokens, `.env` files, or production data.

The current Alpha supports the latest source release only. Until a fix is available, use `check`, `preview`, and `--dry-run` without `--apply` as a safe mitigation.

Automatic fixes keep byte-exact recovery backups under `.git/repofit-comments/backups/`. POSIX implementations enforce private directory/file modes; Windows DACL privacy has not yet been verified and is not part of the current Beta evidence. These files are local Git metadata and are not staged or committed, but they can contain proprietary source text. Automatic writes stop at the documented per-file, record-count, and total-storage limits; RepoFit never silently prunes this history. Protect access to the repository's `.git` directory and manually archive only terminal recovery records that you have confirmed are no longer needed.
