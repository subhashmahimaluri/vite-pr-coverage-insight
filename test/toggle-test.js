// Test file for toggle feature
const fs = require('fs');
const path = require('path');
const { compareCoverage, compareFileCoverage } = require('../src/utils/compareCoverage');
const { formatCoverageMarkdown } = require('../src/utils/formatMarkdown');

// Sample coverage data
const baseCoverage = {
  total: {
    lines: { pct: 80 },
    statements: { pct: 75 },
    functions: { pct: 70 },
    branches: { pct: 65 }
  },
  "src/components/Button.js": {
    lines: { pct: 70 },
    statements: { pct: 65 },
    functions: { pct: 60 },
    branches: { pct: 55 }
  },
  "src/components/Input.js": {
    lines: { pct: 90 },
    statements: { pct: 85 },
    functions: { pct: 80 },
    branches: { pct: 75 }
  }
};

const prCoverage = {
  total: {
    lines: { pct: 85 },
    statements: { pct: 80 },
    functions: { pct: 75 },
    branches: { pct: 70 }
  },
  "src/components/Button.js": {
    lines: { pct: 80 },
    statements: { pct: 75 },
    functions: { pct: 70 },
    branches: { pct: 65 }
  },
  "src/components/Input.js": {
    lines: { pct: 85 },
    statements: { pct: 80 },
    functions: { pct: 75 },
    branches: { pct: 70 }
  },
  "src/components/NewComponent.js": {
    lines: { pct: 95 },
    statements: { pct: 90 },
    functions: { pct: 85 },
    branches: { pct: 80 }
  }
};

// Test the comparison functions
const rows = compareCoverage(baseCoverage, prCoverage);
const fileChanges = compareFileCoverage(baseCoverage, prCoverage);

// Mock PR information for testing
const mockPrInfo = {
  owner: 'example-owner',
  repo: 'example-repo',
  prNumber: 30
};

// Generate markdown with PR info
const markdown = formatCoverageMarkdown(rows, fileChanges, mockPrInfo);

// Write the markdown to a file for inspection
fs.writeFileSync(path.join(__dirname, 'toggle-output.md'), markdown);

console.log('Overall coverage comparison:');
console.log(rows);
console.log('\nFile-level coverage changes:');
console.log(fileChanges);
console.log('\nMarkdown output written to test/toggle-output.md');