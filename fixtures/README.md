# Test fixtures

Each directory holds a `base.json` / `head.json` pair in istanbul
`coverage-summary.json` format, used by the unit/snapshot tests and the CI
dogfood job.

| Scenario       | What it exercises                                          |
| -------------- | ---------------------------------------------------------- |
| `improvement`  | every total metric goes up                                 |
| `regression`   | every total metric goes down                               |
| `new-file`     | file present only in head, 100% covered                    |
| `deleted-file` | file present only in base (must be ignored)                |
| `identical`    | base and head are byte-identical (zero deltas)             |
| `corrupt`      | malformed/empty input routed to the action's error comment |

`test-failures/failures.json` is a sample for the `test-failures` input.

Note: the `lines.details` arrays in some head files are **not** produced by
istanbul's `json-summary` reporter — they exist to exercise the pre-existing
`uncoveredLines` logic in `compareFileCoverage`. With real coverage-summary
input the "Uncovered Lines" column always renders `-`.
