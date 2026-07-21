# GitHub Development and Release Management

This project uses GitHub as the source of truth for code review, CI, issues,
and releases. The repository already contains the CI orchestrator, issue and
pull request templates, Dependabot configuration, security scans, and the
release script. Keep the workflow below when adding new features.

## Development flow

1. Open or find an Issue before starting non-trivial work. Link the Issue from
   the pull request so the change and its motivation remain traceable.
2. Create a focused branch from `main`. Use a descriptive prefix such as
   `feat/`, `fix/`, `refactor/`, `docs/`, or `chore/`.
3. Make small commits with a Conventional Commit-style subject. The release
   script uses prefixes such as `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
   `ci:`, and `chore:` when it groups release notes.
4. Open a pull request using the repository template. A pull request should
   explain the behavior change, testing performed, compatibility impact, and
   any security considerations.
5. Wait for the `All required checks pass` gate and required reviews before
   merging. The gate aggregates the conditionally-run CI lanes, so it is the
   check to use for branch protection.

## Version policy

The Python package uses SemVer. The release version must match in all shipped
surfaces:

- `pyproject.toml` under `[project].version`
- `maliang_cli/__init__.py` under `__version__`
- `apps/desktop/package.json`
- `acp_registry/agent.json` and its exact ACP package pin

Run the consistency check locally before opening a release PR:

```bash
python scripts/check_version_consistency.py
```

The GitHub `Version consistency` workflow checks the same contract on every
relevant pull request and on `main`.

## Release flow

Release tags use CalVer (`vYYYY.M.D`, with a numeric suffix for a second
release on the same day). Use the release helper from a clean, up-to-date
checkout:

```bash
python scripts/release.py --bump patch
python scripts/release.py --bump patch --publish
```

The first command is a dry run. The publish command updates the version files,
creates the tag and GitHub Release, and builds the Python artifacts. Pushing
the tag starts `.github/workflows/upload_to_pypi.yml`, which publishes to PyPI
using trusted publishing and attaches Sigstore signatures to the GitHub
Release. Docker and documentation workflows consume the published Release
event where applicable.

Do not edit generated release notes into the repository. The release helper
creates temporary notes and the GitHub Release is the permanent changelog.

## Repository settings checklist

Configure these once in GitHub repository settings:

- Protect `main`; require pull requests, at least one review, and
  `All required checks pass`.
- Disable force-pushes and branch deletion for `main`.
- Enable Dependabot security updates and GitHub Actions updates.
- Create the `pypi` environment and configure PyPI trusted publishing for the
  repository. No long-lived PyPI token is required.
- Enable GitHub Discussions for design questions that are not actionable
  Issues.

GitHub-side settings require repository-owner access and cannot be represented
reliably by files committed to the project. Keep this checklist next to the
workflows so a new repository or fork can be configured consistently.
