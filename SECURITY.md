# Security policy

RepoFit rewrites source files, so incorrect path handling or comment classification can be security-relevant.

Please avoid public issues for vulnerabilities. Use the repository's private GitHub security-advisory form when available and include the smallest non-sensitive reproduction you can. Never attach proprietary repositories, credentials, tokens, `.env` files, or production data.

The current Alpha supports the latest source release only. Until a fix is available, use `check`, `preview`, and `--dry-run` without `--apply` as a safe mitigation.
