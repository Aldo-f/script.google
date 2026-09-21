// Required Apps Script globals
/* global GmailApp, DriveApp, UrlFetchApp, ScriptApp, Logger, Gmail, Utilities, Session */

/**
 * Rollback functionality for GmailAttachmentCleaner
 * 
 * This module restores emails from their .eml backup files.
 * Each processed email has a complete RFC 2822 .eml file saved in 
 * the Drive backup folder (Gmail Bijlagen Backup/YYYY-MM-DD - Subject/)
 * 
 * Usage:
 *   - Run rollbackOneEmail() to test with ONE email (dry-run by default)
 *   - Set DRY_RUN = false in CONFIG to actually restore
 *   - Run rollbackAllEmails() to restore ALL backed up emails
 */

// ─── ROLLBACK CONFIG ──────────────────────────────────────────────────────────

const ROLLBACK_CONFIG = {
  /** Whether to actually execute restore actions. Set to false for dry-run testing. */
  DRY_RUN: true,

  /** Name of the Google Drive folder where .eml backups are stored. */
  DRIVE_FOLDER_NAME: 'Gmail Bijlagen Backup',

  /** Optional: direct ID of a Drive folder. If set, takes precedence over DRIVE_FOLDER_NAME. */
  DRIVE_FOLDER_ID: '',

  /** Maximum number of emails to restore per run. */
  BATCH_SIZE: 5,

  /** Apply a label to restored messages to identify them. */
  RESTORED_LABEL: 'bijlagen-hersteld',
};

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Gets the backup Drive folder.
 * @returns {GoogleAppsScript.Drive.Folder} The backup folder
 */
function getBackupFolder_() {
  if (ROLLBACK_CONFIG.DRIVE_FOLDER_ID) {
    const folder = DriveApp.getFolderById(ROLLBACK_CONFIG.DRIVE_FOLDER_ID);
    if (!folder) {
      throw new Error(`Drive folder with ID "${ROLLBACK_CONFIG.DRIVE_FOLDER_ID}" not found.`);
    }
    Logger.log('[ROLLBACK] Using folder by ID: ' + ROLLBACK_CONFIG.DRIVE_FOLDER_ID);
    return folder;
  }

  const folders = DriveApp.getFoldersByName(ROLLBACK_CONFIG.DRIVE_FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log('[ROLLBACK] Found backup folder: "' + ROLLBACK_CONFIG.DRIVE_FOLDER_NAME + '" (ID: ' + folder.getId() + ')');
    return folder;
  }

  throw new Error('Backup folder "' + ROLLBACK_CONFIG.DRIVE_FOLDER_NAME + '" not found.');
}

/**
 * Gets or creates the "restored" label.
 * @returns {GoogleAppsScript.Gmail.Label} The label
 */
function getOrCreateRestoredLabel_() {
  try {
    const existing = GmailApp.getUserLabelByName(ROLLBACK_CONFIG.RESTORED_LABEL);
    Logger.log('[ROLLBACK] Found existing label: ' + ROLLBACK_CONFIG.RESTORED_LABEL);
    return existing;
  } catch (e) {
    Logger.log('[ROLLBACK] Label not found, creating: ' + ROLLBACK_CONFIG.RESTORED_LABEL);
    try {
      const created = GmailApp.createLabel(ROLLBACK_CONFIG.RESTORED_LABEL);
      Logger.log('[ROLLBACK] Created label: ' + ROLLBACK_CONFIG.RESTORED_LABEL);
      return created;
    } catch (createError) {
      Logger.log('[ROLLBACK] Failed to create label: ' + createError.message);
      throw createError;
    }
  }
}

/**
 * Lists all .eml backup files in the backup folder.
 * Returns an array of { file, subfolder, subject, date } objects.
 * @returns {Array} Array of backup file info
 */
function listBackupEmlFiles_() {
  const backupFolder = getBackupFolder_();
  const results = [];

  // Get all subfolders (each represents one processed email)
  const subfolders = backupFolder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    
    // Search for .eml files by iterating all files in subfolder
    const files = subfolder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      if (fileName.endsWith('.eml')) {
        results.push({
          file: file,
          subfolder: subfolder,
          subject: fileName.replace('.eml', ''),
          subfolderName: subfolder.getName(),
          date: subfolder.getDateCreated()
        });
      }
    }
  }

  // Sort by date (oldest first)
  results.sort((a, b) => a.date.getTime() - b.date.getTime());
  return results;
}

/**
 * Reads an .eml file and returns its raw content as base64url-encoded string.
 * @param {GoogleAppsScript.Drive.File} emlFile - The .eml file
 * @returns {string} Base64url-encoded raw RFC 2822 message
 */
function readEmlFile_(emlFile) {
  const blob = emlFile.getBlob();
  const bytes = blob.getBytes();
  const base64 = Utilities.base64Encode(bytes);
  // Convert to base64url (Gmail API format)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Inserts a raw message back into Gmail, preserving the original thread.
 * Uses UrlFetchApp REST call (same as main cleaner) to avoid Gmail advanced service bug.
 * @param {string} rawMessage - Base64url-encoded RFC 2822 message
 * @param {string} threadId - Gmail thread ID
 * @param {GoogleAppsScript.Gmail.Label} label - Optional label to apply
 * @returns {object} The inserted message result
 */
function insertRestoredMessage_(rawMessage, threadId, label) {
  const labelId = label ? label.getId() : null;
  
  // Build resource — raw must be INSIDE resource
  const resource = { raw: rawMessage };
  if (labelId) {
    resource.labelIds = [labelId];
  }
  
  // Gmail advanced service insert() is broken for raw messages in Apps Script.
  // Use UrlFetchApp to call the REST API directly with JSON payload.
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
    },
    payload: JSON.stringify(resource),
    muteHttpExceptions: true
  };
  
  Logger.log('[ROLLBACK] base64url length: %s, calling UrlFetchApp', rawMessage.length);
  
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  
  if (responseCode >= 200 && responseCode < 300) {
    const result = JSON.parse(responseBody);
    Logger.log('[ROLLBACK] Restored message inserted into thread %s (new message ID: %s)', threadId, result.id);
    return result;
  } else {
    throw new Error('Gmail API insert failed (HTTP ' + responseCode + '): ' + responseBody);
  }
}

/**
 * Extracts thread ID from an .eml filename or subfolder name.
 * The subfolder is named like "2026-09-18 - Subject"
 * We need to search Gmail for the thread by subject/date.
 * @param {string} subfolderName - Name of the subfolder
 * @returns {string|null} Thread ID or null if not found
 */
function findThreadIdFromBackup_(subfolderName) {
  // Parse date and subject from subfolder name: "YYYY-MM-DD - Subject"
  const match = subfolderName.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(.+)$/);
  if (!match) {
    Logger.log('[ROLLBACK] Could not parse subfolder name: ' + subfolderName);
    return null;
  }

  const dateStr = match[1];
  const subject = match[2];
  
  Logger.log('[ROLLBACK] Searching for thread: date=' + dateStr + ', subject=' + subject);

  // Search Gmail for messages with this subject around this date
  // Use a narrow date range to find the right thread
  const searchQuery = 'subject:' + subject + ' after:' + dateStr + ' before:' + 
    Utilities.formatDate(new Date(new Date(dateStr).getTime() + 24*60*60*1000), Session.getScriptTimeZone(), 'yyyy/MM/dd');
  
  const threads = GmailApp.search(searchQuery, 0, 10);
  
  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      const msgDate = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (msgDate === dateStr && message.getSubject() === subject) {
        Logger.log('[ROLLBACK] Found matching thread: ' + thread.getId());
        return thread.getId();
      }
    }
  }

  Logger.log('[ROLLBACK] No matching thread found for: ' + subfolderName);
  return null;
}

// ─── ROLLBACK FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Restores a single email from its .eml backup.
 * @param {number} index - Index in the list of backup files (0 = oldest)
 * @returns {object} Result object
 */
function rollbackOneEmail(index = 0) {
  Logger.log('=== ROLLBACK START (single email) ===');
  
  const backups = listBackupEmlFiles_();
  Logger.log('[ROLLBACK] Found ' + backups.length + ' backup .eml file(s)');
  
  if (backups.length === 0) {
    Logger.log('[ROLLBACK] No backup files found!');
    return { success: false, error: 'No backup files found' };
  }

  if (index >= backups.length) {
    Logger.log('[ROLLBACK] Index ' + index + ' out of range (max: ' + (backups.length - 1) + ')');
    return { success: false, error: 'Index out of range' };
  }

  const backup = backups[index];
  Logger.log('[ROLLBACK] Processing: ' + backup.subfolderName);
  Logger.log('[ROLLBACK] .eml file: ' + backup.file.getName());
  Logger.log('[ROLLBACK] DRY_RUN: ' + ROLLBACK_CONFIG.DRY_RUN);

  // Find the original thread ID
  const threadId = findThreadIdFromBackup_(backup.subfolderName);
  if (!threadId) {
    Logger.log('[ROLLBACK] Could not find original thread. Trying to insert as new thread...');
    // As fallback, try to insert without threadId (will create new thread)
    // This preserves the email but not the original thread
    return restoreEmlToNewThread_(backup);
  }

  // Read the .eml file
  const rawMessage = readEmlFile_(backup.file);
  Logger.log('[ROLLBACK] Read .eml file, size: ' + rawMessage.length + ' chars');

  if (ROLLBACK_CONFIG.DRY_RUN) {
    Logger.log('[ROLLBACK] DRY_RUN mode — not inserting message');
    Logger.log('[ROLLBACK] Would restore to thread: ' + threadId);
    return { 
      success: true, 
      dryRun: true, 
      threadId: threadId,
      subject: backup.subject,
      subfolder: backup.subfolderName
    };
  }

  // Insert the restored message
  const restoredLabel = getOrCreateRestoredLabel_();
  const result = insertRestoredMessage_(rawMessage, threadId, restoredLabel);
  
  Logger.log('[ROLLBACK] Successfully restored email to thread ' + threadId);
  Logger.log('=== ROLLBACK COMPLETE ===');
  
  return { 
    success: true, 
    dryRun: false, 
    messageId: result.id,
    threadId: threadId,
    subject: backup.subject,
    subfolder: backup.subfolderName
  };
}

/**
 * Restores an .eml file as a new thread (when original thread not found).
 * Uses UrlFetchApp REST call to avoid Gmail advanced service bug.
 * @param {object} backup - Backup file info
 * @returns {object} Result object
 */
function restoreEmlToNewThread_(backup) {
  Logger.log('[ROLLBACK] Restoring as new thread (original thread not found)');

  const rawMessage = readEmlFile_(backup.file);

  if (ROLLBACK_CONFIG.DRY_RUN) {
    Logger.log('[ROLLBACK] DRY_RUN mode — not inserting message');
    return {
      success: true,
      dryRun: true,
      subject: backup.subject,
      subfolder: backup.subfolderName,
      note: 'Would create new thread'
    };
  }

  // Insert without threadId creates a new thread — no label required
  const resource = { 
    raw: rawMessage
  };

  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
    },
    payload: JSON.stringify(resource),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode >= 200 && responseCode < 300) {
    const result = JSON.parse(responseBody);
    Logger.log('[ROLLBACK] Created new thread with restored message (ID: %s, threadId: %s)', result.id, result.threadId);
    Logger.log('=== ROLLBACK COMPLETE ===');
    return {
      success: true,
      dryRun: false,
      messageId: result.id,
      threadId: result.threadId,
      subject: backup.subject,
      subfolder: backup.subfolderName,
      note: 'Created new thread'
    };
  } else {
    throw new Error('Gmail API insert failed (HTTP ' + responseCode + '): ' + responseBody);
  }
}

/**
 * Restores ALL backed up emails.
 * @returns {object} Summary of results
 */
function rollbackAllEmails() {
  Logger.log('=== ROLLBACK START (all emails) ===');
  
  const backups = listBackupEmlFiles_();
  Logger.log('[ROLLBACK] Found ' + backups.length + ' backup .eml file(s)');
  
  if (backups.length === 0) {
    Logger.log('[ROLLBACK] No backup files found!');
    return { success: false, error: 'No backup files found', processed: 0 };
  }

  const limit = Math.min(backups.length, ROLLBACK_CONFIG.BATCH_SIZE);
  const results = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < limit; i++) {
    Logger.log('[ROLLBACK] Processing ' + (i + 1) + '/' + limit + ': ' + backups[i].subfolderName);
    const result = rollbackOneEmail(i);
    results.push(result);
    
    if (result.success) {
      successCount++;
    } else {
      errorCount++;
    }
    
    // Small delay to avoid rate limits
    Utilities.sleep(500);
  }

  Logger.log('[ROLLBACK] Summary: ' + successCount + ' restored, ' + errorCount + ' failed');
  Logger.log('=== ROLLBACK COMPLETE ===');
  
  return { 
    success: errorCount === 0,
    processed: successCount,
    failed: errorCount,
    results: results
  };
}

/**
 * Lists all available backup emails for rollback.
 * @returns {Array} Array of backup info
 */
function listRollbackCandidates_() {
  const backups = listBackupEmlFiles_();
  
  Logger.log('[ROLLBACK] Available backups for restoration:');
  backups.forEach((backup, index) => {
    Logger.log('  [' + index + '] ' + backup.subfolderName + ' — ' + backup.file.getName());
  });
  
  return backups;
}

/**
 * Test function: Run rollback on ONE email in DRY_RUN mode.
 * Safe to run anytime.
 */
function testRollbackOne() {
  ROLLBACK_CONFIG.DRY_RUN = true;
  Logger.log('[TEST] Running rollback test on ONE email (dry-run)');
  return rollbackOneEmail(0);
}

/**
 * Test function: Run rollback on ONE email for REAL (not dry-run).
 * ONLY RUN AFTER VERIFYING DRY_RUN WORKS!
 */
function testRollbackOneReal() {
  ROLLBACK_CONFIG.DRY_RUN = false;
  Logger.log('[TEST] Running rollback test on ONE email (REAL)');
  return rollbackOneEmail(0);
}