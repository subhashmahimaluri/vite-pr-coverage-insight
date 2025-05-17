"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const formatMarkdown_1 = require("./utils/formatMarkdown");
const github_2 = require("./utils/github");
const compareCoverage_1 = require("./utils/compareCoverage");
async function run() {
    try {
        const githubToken = (0, core_1.getInput)("github-token", { required: true });
        const basePath = (0, core_1.getInput)("base", { required: true });
        const headPath = (0, core_1.getInput)("head", { required: true });
        const baseJson = fs_1.default.readFileSync(path_1.default.resolve(basePath), "utf-8");
        const headJson = fs_1.default.readFileSync(path_1.default.resolve(headPath), "utf-8");
        const base = JSON.parse(baseJson);
        const pr = JSON.parse(headJson);
        const rows = (0, compareCoverage_1.compareCoverage)(base, pr);
        const fileChanges = (0, compareCoverage_1.compareFileCoverage)(base, pr);
        const markdown = (0, formatMarkdown_1.formatCoverageMarkdown)(rows, fileChanges);
        const octokit = (0, github_1.getOctokit)(githubToken);
        const { owner, repo } = github_1.context.repo;
        const prNumber = github_1.context.payload.pull_request?.number;
        if (!prNumber)
            throw new Error("Pull request number not found");
        await (0, github_2.upsertCoverageComment)({
            octokit,
            owner,
            repo,
            prNumber,
            body: markdown,
        });
    }
    catch (error) {
        console.error("❌ Error generating coverage comment:", error);
    }
}
run();
