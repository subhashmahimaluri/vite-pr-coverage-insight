import * as core from '@actions/core';
import fs from 'fs';
import { formatMarkdown } from './formatMarkdown';
import { postComment } from './postComment';

async function run() {
  try {
    const token = core.getInput('github-token');
    const basePath = core.getInput('base');
    const headPath = core.getInput('head');

    const base = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
    const pr = JSON.parse(fs.readFileSync(headPath, 'utf-8'));

    const markdown = formatMarkdown(base, pr);
    await postComment(token, markdown);
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();