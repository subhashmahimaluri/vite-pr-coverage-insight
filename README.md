# Vite PR Coverage Insight

A GitHub Action that compares test coverage between base and PR branches, and posts the results as a comment on the PR.

## Features

- Compares overall coverage metrics (statements, branches, functions, lines)
- Shows file-level coverage changes in a collapsible section
- Highlights newly added files and modified files
- Shows uncovered lines for each file
- Supports failed test reporting

## Usage

```yaml
name: PR Coverage Report

on:
  pull_request:
    branches:
      - main

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      # Setup and run tests on PR
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: yarn install
      
      - name: Run tests with coverage
        run: yarn test:coverage
        continue-on-error: true  # Continue even if tests fail
      
      - name: Save PR coverage
        run: |
          mkdir -p pr-coverage
          cp coverage/coverage-summary.json pr-coverage/
          
      # Generate test failures JSON if tests failed
      - name: Generate test failures JSON
        run: |
          if [ $? -ne 0 ]; then
            node scripts/extract-test-failures.js > test-failures.json
          else
            echo '{"numFailedTests": 0, "numTotalTests": 0, "failedTests": []}' > test-failures.json
          fi
      
      # Checkout main to compare base coverage
      - name: Checkout main branch
        run: |
          git fetch origin main
          git checkout origin/main
      
      - name: Install dependencies (main)
        run: yarn install
      
      - name: Run coverage on main
        run: yarn test:coverage
      
      - name: Save base coverage
        run: |
          mkdir -p base-coverage
          cp coverage/coverage-summary.json base-coverage/
      
      # Run PR Coverage Insight Action
      - name: Run vite-pr-coverage-insight action
        uses: subhashmahimaluri/vite-pr-coverage-insight@v1.3.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          base: base-coverage/coverage-summary.json
          head: pr-coverage/coverage-summary.json
          test-failures: test-failures.json
          use-check-run: true
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for PR comment | Yes | - |
| `base` | Path to base coverage-summary.json | Yes | - |
| `head` | Path to PR coverage-summary.json | Yes | - |
| `test-failures` | Path to test failures JSON file | No | - |
| `use-check-run` | Whether to use GitHub Check Run API | No | `false` |

## Test Failures JSON Format

If you want to include failed test information in the coverage report, you need to provide a JSON file with the following format:

```json
{
  "numFailedTests": 3,
  "numTotalTests": 50,
  "failedTests": [
    {
      "testName": "should render component correctly",
      "filePath": "src/components/Button.test.js"
    },
    {
      "testName": "should handle click events",
      "filePath": "src/components/Input.test.js"
    }
  ]
}
```

## Output

The action will post a comment to the PR with:

1. A summary table showing overall coverage metrics
2. A collapsible section with file-level coverage details
3. A collapsible section with failed test information (if provided)

The action will exit with an error code if tests failed, but the coverage report will still be generated and posted to the PR.

## License

MIT
