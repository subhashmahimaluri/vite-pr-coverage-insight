# Using `covins` outside GitHub Actions

The `covins` CLI shares 100% of its logic with the GitHub Action (compare,
config, policy, reporters) — only the argument parsing differs. Exit codes for
`covins check`: **0** pass, **1** warn, **2** fail.

```bash
npm install -D @coverage-insight/cli
npx covins check --head coverage/coverage-summary.json   # gates on config thresholds
```

Input may be istanbul `coverage-summary.json`, `lcov.info`, or v8/c8
`coverage-final.json` — the format is auto-detected. Thresholds and ratchet
come from `coverage-insight.config.{ts,mjs,json}` or a `"coverage-insight"`
key in package.json.

## GitLab CI

```yaml
coverage:
  image: node:24
  script:
    - npm ci
    - npm test -- --coverage
    - npx covins check --head coverage/coverage-summary.json
    - npx covins report --head coverage/coverage-summary.json --format html --out coverage-report.html
  artifacts:
    when: always
    paths: [coverage-report.html]
```

## Jenkins (declarative)

```groovy
stage('Coverage gate') {
  steps {
    sh 'npm ci && npm test -- --coverage'
    // exit code 2 fails the stage; 1 (warn) can be tolerated with catchError
    sh 'npx covins check --head coverage/coverage-summary.json'
    sh 'npx covins report --head coverage/coverage-summary.json --format html --out coverage-report.html'
    archiveArtifacts artifacts: 'coverage-report.html'
  }
}
```

## Azure Pipelines

```yaml
steps:
  - task: NodeTool@0
    inputs: { versionSpec: '24.x' }
  - script: npm ci && npm test -- --coverage
  - script: npx covins check --head coverage/coverage-summary.json
    displayName: Coverage gate
  - script: npx covins report --head coverage/coverage-summary.json --format html --out $(Build.ArtifactStagingDirectory)/coverage-report.html
    condition: always()
  - task: PublishBuildArtifacts@1
    condition: always()
    inputs: { pathToPublish: $(Build.ArtifactStagingDirectory) }
```

## Comparing against a stored baseline

CI systems without the action's baseline store can keep it simple: archive
`coverage-summary.json` from the main-branch pipeline, fetch it in the PR
pipeline, then:

```bash
npx covins compare --base main-coverage.json --head coverage/coverage-summary.json
```
