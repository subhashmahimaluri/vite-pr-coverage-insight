// Test file for toggle feature
import * as fs from 'fs';
import * as path from 'path';
import { compareCoverage, compareFileCoverage, CoverageSummary } from '../src/utils/compareCoverage';
import { formatCoverageMarkdown } from '../src/utils/formatMarkdown';

// Sample coverage data with required fields
const baseCoverage: CoverageSummary = {
  total: {
    lines: { pct: 80, total: 100, covered: 80, skipped: 0 },
    statements: { pct: 75, total: 100, covered: 75, skipped: 0 },
    functions: { pct: 70, total: 10, covered: 7, skipped: 0 },
    branches: { pct: 65, total: 20, covered: 13, skipped: 0 }
  },
  "src/components/Button.js": {
    lines: { pct: 70, total: 50, covered: 35, skipped: 0 },
    statements: { pct: 65, total: 60, covered: 39, skipped: 0 },
    functions: { pct: 60, total: 5, covered: 3, skipped: 0 },
    branches: { pct: 55, total: 10, covered: 5.5, skipped: 0 }
  },
  "src/components/Input.js": {
    lines: { pct: 90, total: 50, covered: 45, skipped: 0 },
    statements: { pct: 85, total: 40, covered: 34, skipped: 0 },
    functions: { pct: 80, total: 5, covered: 4, skipped: 0 },
    branches: { pct: 75, total: 10, covered: 7.5, skipped: 0 }
  }
};

const prCoverage: CoverageSummary = {
  total: {
    lines: { pct: 85, total: 120, covered: 102, skipped: 0 },
    statements: { pct: 80, total: 120, covered: 96, skipped: 0 },
    functions: { pct: 75, total: 12, covered: 9, skipped: 0 },
    branches: { pct: 70, total: 24, covered: 16.8, skipped: 0 }
  },
  "src/components/Button.js": {
    lines: {
      pct: 80,
      total: 50,
      covered: 40,
      skipped: 0,
      details: [
        { line: 5, covered: false },
        { line: 10, covered: false },
        { line: 15, covered: false }
      ]
    },
    statements: { pct: 75, total: 60, covered: 45, skipped: 0 },
    functions: { pct: 70, total: 5, covered: 3.5, skipped: 0 },
    branches: { pct: 65, total: 10, covered: 6.5, skipped: 0 }
  },
  "src/components/Input.js": {
    lines: {
      pct: 85,
      total: 50,
      covered: 42.5,
      skipped: 0,
      details: [
        { line: 8, covered: false },
        { line: 12, covered: false }
      ]
    },
    statements: { pct: 80, total: 40, covered: 32, skipped: 0 },
    functions: { pct: 75, total: 5, covered: 3.75, skipped: 0 },
    branches: { pct: 70, total: 10, covered: 7, skipped: 0 }
  },
  "src/components/NewComponent.js": {
    lines: {
      pct: 100,
      total: 20,
      covered: 20,
      skipped: 0,
      details: []
    },
    statements: { pct: 100, total: 20, covered: 20, skipped: 0 },
    functions: { pct: 100, total: 2, covered: 2, skipped: 0 },
    branches: { pct: 100, total: 4, covered: 4, skipped: 0 }
  }
};

// Test the comparison functions
const rows = compareCoverage(baseCoverage, prCoverage);
const fileCoverage = compareFileCoverage(baseCoverage, prCoverage);

// Mock PR information for testing
const mockPrInfo = {
  owner: 'example-owner',
  repo: 'example-repo',
  prNumber: 30
};

// Generate markdown with PR info
const markdown = formatCoverageMarkdown(rows, fileCoverage, mockPrInfo);

// Write the markdown to a file for inspection
fs.writeFileSync(path.join(__dirname, 'toggle-output.md'), markdown);

console.log('Overall coverage comparison:');
console.log(rows);
console.log('\nFile-level coverage changes:');
console.log(JSON.stringify(fileCoverage, null, 2));
console.log('\nMarkdown output written to test/toggle-output.md');