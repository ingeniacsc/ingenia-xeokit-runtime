import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "dist", "node_modules", "coverage", "tmp"]);
const ignoredSelfTests = new Set([
  "scripts/validate-publication.mjs",
  "tests/publication/release-readiness.test.mjs",
]);
const textNames = new Set(["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES", ".dockerignore"]);
const textExtensions = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".txt", ".yml", ".yaml",
]);

const customerCodes = [
  ["H", "B", "S"].join(""),
  ["R", "T", "N"].join(""),
  ["T", "K", "B"].join(""),
];

function isTextPath(relativePath) {
  return textNames.has(path.basename(relativePath)) || textExtensions.has(path.extname(relativePath));
}

export function scanText(text, relativePath = "synthetic.txt") {
  const findings = [];
  const record = (rule, match) => findings.push({ relativePath, rule, match: match.slice(0, 120) });
  const checks = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["github-token", /gh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}/g],
    ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
    ["credential-assignment", /(?:password|passwd|secret|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi],
    ["private-monorepo", /github\.com\/ingeniacsc\/ingenia-ecosystem/gi],
    ["private-absolute-path", /(?:[A-Za-z]:\\(?:Users|ingenia_ecosystem)|\/(?:root|home)\/)[^\s"']*/g],
    ["private-backend-seam", /(?:from\s+django|import\s+django|celery\.shared_task|apps\.core|permission_classes\s*=|auth_token\s*=)/gi],
  ];
  for (const [rule, expression] of checks) {
    for (const match of text.matchAll(expression)) record(rule, match[0]);
  }
  for (const code of customerCodes) {
    const expression = new RegExp(`\\b${code}\\b`, "g");
    for (const match of text.matchAll(expression)) record("customer-project-code", match[0]);
  }

  const permitsLoopback = new Set([
    "docker/docker-compose.yml",
    ".github/workflows/release-preflight.yml",
    ".github/workflows/release.yml",
    "scripts/verify-running-image.mjs",
  ]).has(relativePath);
  if (!permitsLoopback) {
    const internalOrigin = /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?/g;
    for (const match of text.matchAll(internalOrigin)) record("internal-origin", match[0]);
  }
  return findings;
}

async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolutePath, relativePath));
    else if (entry.isFile() && isTextPath(relativePath)) files.push({ absolutePath, relativePath });
  }
  return files;
}

export async function scanPublicTree(root = runtimeRoot) {
  const findings = [];
  for (const file of await collectFiles(root)) {
    if (ignoredSelfTests.has(file.relativePath)) continue;
    findings.push(...scanText(await readFile(file.absolutePath, "utf8"), file.relativePath));
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = await scanPublicTree();
  if (findings.length) {
    console.error(JSON.stringify({ status: "blocked", findings }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ status: "ok", findings: [] }));
  }
}
