import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('🔒 GitHub Actions Workflow Security Audit', () => {
  const workflowsDir = path.resolve('.github', 'workflows');

  test('workflow files do not directly interpolate untrusted payloads in run blocks', () => {
    const ymlFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    const violations = [];

    // Regex checking for ${{ github.event.client_payload.* }} or ${{ github.event.inputs.* }} inside run blocks
    const dangerousInterpolationRegex = /\$\{\{\s*(?:toJson\()?\s*github\.event\.(?:client_payload|inputs)\b[^}]*\}\}/i;

    for (const file of ymlFiles) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
      const lines = content.split(/\r?\n/);
      let inRunBlock = false;
      let runIndentation = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();
        const currentIndent = line.length - trimmed.length;

        // Detect start of run: block
        if (/^\s*run:\s*[|>-]?\s*$/.test(line)) {
          inRunBlock = true;
          runIndentation = currentIndent;
          continue;
        }

        // Detect end of run: block (less or equal indentation to parent, not empty)
        if (inRunBlock) {
          if (trimmed.length > 0 && currentIndent <= runIndentation) {
            inRunBlock = false;
          } else {
            // We are inside a run: block! Check for dangerous interpolation
            if (dangerousInterpolationRegex.test(line)) {
              violations.push({
                file,
                line: i + 1,
                content: line.trim()
              });
            }
          }
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found dangerous inline template interpolation in workflow run: blocks (CWE-78 Command Injection Risk):\n` +
      violations.map(v => `  ${v.file}:${v.line} -> ${v.content}`).join('\n')
    );
  });
});
