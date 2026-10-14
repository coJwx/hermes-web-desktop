## ADDED Requirements

### Requirement: A Web-only checkout can produce frontend assets
The repository SHALL install with its frozen pnpm lockfile and build frontend assets using Node/pnpm without parent Hermes directories, Python, Rust or a running backend. Production build MUST execute TypeScript checking and default to repository-local dist.

#### Scenario: Isolated source tree
- **WHEN** only Web repository files are present and dependencies are installed with pnpm install --frozen-lockfile
- **THEN** pnpm build produces dist/index.html and referenced assets without accessing parent apps/shared or scripts

### Requirement: Shared code is a pinned local snapshot
The repository SHALL use the same local shared snapshot for application, types and tests, retain its MIT license and source revision/hash metadata, and require explicit source/ref for refresh. A normal build MUST NOT fetch upstream or regenerate backend contracts.

#### Scenario: Refresh preserves provenance
- **WHEN** a maintainer refreshes shared code from an explicit Hermes commit
- **THEN** source bytes, license and provenance are updated together and local modified snapshot files are not silently overwritten

### Requirement: Existing frontend behavior remains compatible
The change SHALL preserve RPC/authentication behavior and the explicit dist-desktop frontend build target. Scope acceptance SHALL distinguish static frontend build from native packaging and remote-server validation.

#### Scenario: Existing Web regressions
- **WHEN** the Web suite runs against the local snapshot in an isolated checkout
- **THEN** chat/profile/leave and existing UI contracts pass without importing shared code from another checkout
