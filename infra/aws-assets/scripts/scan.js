// Greps this folder for AWS secrets and account ids. Exits 1 on any hit.
const { readdirSync, readFileSync, statSync } = require('fs');
const { join } = require('path');

const SKIP = new Set(['node_modules', 'cdk.out']);
const RULES = [
  ['access key id', /\b(AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['secret key near "aws_secret"', /aws_secret[^\n]{0,40}[A-Za-z0-9/+=]{40}/i],
  ['session token', /aws_session_toke[n]|x-amz-security-toke[n]/i],
  ['12-digit account id', /(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/],
];

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

let hits = 0;
for (const file of listFiles(join(__dirname, '..'))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    for (const [label, pattern] of RULES) {
      if (pattern.test(line)) {
        hits += 1;
        console.error(`${file}:${index + 1}: ${label}`);
      }
    }
  });
}
console.log(hits === 0 ? 'scan clean' : `scan found ${hits} hit(s)`);
process.exit(hits === 0 ? 0 : 1);
