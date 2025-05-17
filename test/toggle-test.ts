// Test file for toggle feature
import * as fs from 'fs';
import * as path from 'path';
import { compareCoverage, compareFileCoverage, CoverageSummary } from '../src/utils/compareCoverage';
import { formatCoverageMarkdown } from '../src/utils/formatMarkdown';

// Sample coverage data
const baseCoverage: CoverageSummary = {
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

const prCoverage: CoverageSummary = {
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

// Generate markdown
const markdown = formatCoverageMarkdown(rows, fileChanges);

// Write the markdown to a file for inspection
fs.writeFileSync(path.join(__dirname, 'toggle-output.md'), markdown);

console.log('Overall coverage comparison:');
console.log(rows);
console.log('\nFile-level coverage changes:');
console.log(fileChanges);
console.log('\nMarkdown output written to test/toggle-output.md');