const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const chokidar = require('chokidar');

// Create Express app
const app = express();
const port = 3000;

// Serve static files from the test directory
app.use(express.static(path.join(__dirname)));

// Route for the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'toggle-preview.html'));
});

// Function to run the test and update the output
function runTest() {
  console.log('🔄 Source files changed, running test...');
  exec('npx tsx test/toggle-test.ts', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error running test: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Test stderr: ${stderr}`);
    }
    console.log(`Test output: ${stdout}`);
    console.log('✅ Test completed and output updated');
  });
}

// Watch for changes in source files
const watcher = chokidar.watch([
  path.join(__dirname, '../src/**/*.ts'),
  path.join(__dirname, 'toggle-test.ts')
], {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true
});

watcher
  .on('change', path => {
    console.log(`File ${path} has been changed`);
    runTest();
  });

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('Watching for file changes...');
  
  // Run the test initially
  runTest();
});