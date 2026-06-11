#!/usr/bin/env node

/**
 * Example script to extract test failures from test results
 * This is a simple example that can be adapted to different test runners
 * 
 * Usage: node scripts/extract-test-failures.js > test-failures.json
 * 
 * Note: This is just an example. You'll need to adapt this to your specific test runner
 * and test result format.
 */

// This is a placeholder for reading test results
// In a real implementation, you would read the test results from a file or from stdin
const readTestResults = () => {
  // Example: Read from a file
  // const fs = require('fs');
  // const testResults = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));
  // return testResults;
  
  // For this example, we'll just return some mock data
  return {
    numFailedTests: 3,
    numPassedTests: 47,
    testResults: [
      {
        name: 'src/components/Button.test.js',
        status: 'failed',
        assertionResults: [
          {
            title: 'should render component correctly',
            status: 'failed',
            failureMessages: ['Expected <div> to have class "button", but found "btn"']
          },
          {
            title: 'should have correct props',
            status: 'passed'
          }
        ]
      },
      {
        name: 'src/components/Input.test.js',
        status: 'failed',
        assertionResults: [
          {
            title: 'should handle click events',
            status: 'failed',
            failureMessages: ['Expected function to be called 1 time, but was called 0 times']
          },
          {
            title: 'should render correctly',
            status: 'passed'
          }
        ]
      },
      {
        name: 'src/components/Form.test.js',
        status: 'failed',
        assertionResults: [
          {
            title: 'should validate form input',
            status: 'failed',
            failureMessages: ['Expected validation to fail, but it passed']
          },
          {
            title: 'should submit form data',
            status: 'passed'
          }
        ]
      }
    ]
  };
};

/**
 * Extract failed tests from test results
 * @param {Object} testResults - Test results from the test runner
 * @returns {Object} - Failed tests in the format expected by the action
 */
const extractFailedTests = (testResults) => {
  const failedTests = [];
  
  // Extract failed tests from test results
  testResults.testResults.forEach(testFile => {
    testFile.assertionResults.forEach(test => {
      if (test.status === 'failed') {
        failedTests.push({
          testName: test.title,
          filePath: testFile.name
        });
      }
    });
  });
  
  return {
    numFailedTests: testResults.numFailedTests,
    numTotalTests: testResults.numFailedTests + testResults.numPassedTests,
    failedTests
  };
};

// Main function
const main = () => {
  try {
    const testResults = readTestResults();
    const failedTests = extractFailedTests(testResults);
    
    // Output the failed tests as JSON
    console.log(JSON.stringify(failedTests, null, 2));
  } catch (error) {
    console.error('Error extracting test failures:', error);
    process.exit(1);
  }
};

// Run the script
main();