#!/usr/bin/env node
/**
 * Local validation script for Google Apps Script projects.
 * Run with: npm run validate
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECTS = ['LabelReminder', 'FollowUpReminder'];

const REQUIRED_FUNCTIONS = {
  LabelReminder: [
    'checkReminders', 'autoPauseOnReply', 'previewReminders', 'dryRun',
    'sendReminder', 'generateReminderText', 'getGeminiApiKeys',
    'callFreeLLM', 'callGemini', 'callAI', 'setup'
  ],
  FollowUpReminder: [
    'checkDigests', 'checkEscalations', 'processFollowUps', 'collectPending',
    'sendDigest', 'sendEscalation', 'rewriteWithLlm',
    'callFreeLLM', 'callGemini', 'callAI', 'getGeminiApiKeys', 'setup', 'syncLabels'
  ],
};

function checkSyntax(filePath) {
  const code = readFileSync(filePath, 'utf8');
  try {
    // Basic syntax check - wrap in function to catch errors
    new Function(`
      const console = { log: () => {} };
      const Logger = { log: () => {} };
      const PropertiesService = { getScriptProperties: () => ({ getProperty: () => '' }) };
      const ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }) };
      const GmailApp = { search: () => [], getUserLabels: () => [], getUserLabelByName: () => null, createLabel: () => ({ addLabel: () => {}, removeLabel: () => {}, getName: () => '' }), createDraft: () => {}, sendEmail: () => {} };
      const UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }) };
      const DriveApp = { getFileById: () => ({ getAs: () => ({ setName: () => {} }), setTrashed: () => {} }) };
      const DocumentApp = { create: () => ({ getId: () => '', getBody: () => ({ appendParagraph: () => ({ setHeading: () => {} }), appendPageBreak: () => {}, appendHorizontalRule: () => {}, saveAndClose: () => {} }) }) };
      const Utilities = { formatDate: () => '' };
      ${code}
    `);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function checkFunctions(project, code) {
  const missing = [];
  for (const fn of REQUIRED_FUNCTIONS[project]) {
    if (!code.includes(`function ${fn}`)) {
      missing.push(fn);
    }
  }
  return missing;
}

function checkConfig(code) {
  return code.includes('CONFIG =');
}

function main() {
  let allOk = true;

  for (const project of PROJECTS) {
    const dir = join(process.cwd(), project);
    const files = readdirSync(dir).filter(f => f.endsWith('.gs'));

    console.log(`\n📦 Validating ${project}...`);

    for (const file of files) {
      const filePath = join(dir, file);
      console.log(`  Checking ${file}...`);

      // Syntax check
      const syntax = checkSyntax(filePath);
      if (!syntax.ok) {
        console.error(`    ❌ Syntax error: ${syntax.error}`);
        allOk = false;
      } else {
        console.log(`    ✅ Syntax OK`);
      }

      // Function check (only main Code.gs)
      if (file === 'Code.gs') {
        const code = readFileSync(filePath, 'utf8');
        const missing = checkFunctions(project, code);
        if (missing.length > 0) {
          console.error(`    ❌ Missing functions: ${missing.join(', ')}`);
          allOk = false;
        } else {
          console.log(`    ✅ All required functions present`);
        }

        if (!checkConfig(code)) {
          console.error(`    ❌ Missing CONFIG object`);
          allOk = false;
        } else {
          console.log(`    ✅ CONFIG object present`);
        }
      }
    }
  }

  console.log(`\n${allOk ? '✅ All checks passed!' : '❌ Some checks failed'}`);
  process.exit(allOk ? 0 : 1);
}

main();