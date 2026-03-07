# CodeDrift GitHub Action

Catch security bugs that AI coding assistants silently ship. Get inline PR annotations, job summaries, and optional SARIF upload.

## Usage

```yaml
name: Security Check
on: [push, pull_request]

jobs:
  codedrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: hamzzaaamalik/codedrift-action@v1
        with:
          confidence-threshold: 'high'
```

## What You Get

- **Inline PR annotations** - Issues appear directly on the lines in your PR diff
- **Job summary** - Severity breakdown table in the Actions Summary tab
- **Fail control** - Choose to fail on errors, warnings, or never
- **SARIF upload** - Optional upload to GitHub Code Scanning

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `confidence-threshold` | Minimum confidence: `high`, `medium`, `low` | `high` |
| `fail-on` | Fail on: `error`, `warn`, `none` | `error` |
| `exclude-tests` | Skip test files | `true` |
| `working-directory` | Directory to scan | `.` |
| `sarif` | Generate SARIF for Code Scanning | `false` |
| `version` | CodeDrift version to install | `latest` |

## Outputs

| Output | Description |
|--------|-------------|
| `total-issues` | Total number of issues found |
| `critical-count` | Number of critical issues |
| `high-count` | Number of high/error severity issues |
| `report-json` | Path to the JSON report file |

## Advanced Examples

### Fail only on critical issues

```yaml
- uses: hamzzaaamalik/codedrift-action@v1
  with:
    confidence-threshold: 'high'
    fail-on: 'error'
```

### With SARIF upload to Code Scanning

```yaml
- uses: hamzzaaamalik/codedrift-action@v1
  with:
    sarif: 'true'

- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: codedrift-results.sarif
```

### Monorepo - scan specific package

```yaml
- uses: hamzzaaamalik/codedrift-action@v1
  with:
    working-directory: 'packages/api'
```

### Use output in subsequent steps

```yaml
- uses: hamzzaaamalik/codedrift-action@v1
  id: scan
  with:
    fail-on: 'none'

- run: echo "Found ${{ steps.scan.outputs.total-issues }} issues"
```

## License

MIT
