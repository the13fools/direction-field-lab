# Security

Geometry Processing Lab is a static, local-first application. Report a security
issue privately to the repository owner rather than opening a public issue.

The local Polyscope bridge binds only to `127.0.0.1`, validates the snapshot
schema, limits request size, and never evaluates submitted code. Do not expose it
through a public reverse proxy. The application does not accept or store Git
credentials.
