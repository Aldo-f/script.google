// Required Apps Script globals
/* global GmailApp, DriveApp, UrlFetchApp, ScriptApp, Logger, Gmail */

/**
 * GmailAttachmentCleaner.gs
 *
 * Automatically removes large attachments from Gmail to save storage space,
 * while preserving the email message itself (original date, sender, recipients,
 * formatting, and text). All attachments are first safely backed up to a
 * dedicated folder on Google Drive.
 *
 * SETUP:
 *   1. script.google.com → New project → paste this file
 *   2. Enable "Gmail API" Advanced Service (Resources → Advanced Google services → Gmail API)
 *   3. In the Google Cloud Console (linked project), enable Gmail API
 *   4. Run processAttachments() manually for testing
 *
 * CONFIGURATION:
 *   All settings are in the CONFIG object below — just edit the values.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────

/**
 * Configuration block. Edit these values to match your needs.
 */
const CONFIG = {
  /** Gmail search query. Matches messages with large attachments that haven't been processed yet. */
  SEARCH_QUERY: 'has:attachment larger:10M',

  /** Name of the Google Drive folder where attachments will be backed up. */
  DRIVE_FOLDER_NAME: 'Gmail Bijlagen Backup',

  /** Optional: direct ID of a Drive folder. If set, takes precedence over DRIVE_FOLDER_NAME. */
  DRIVE_FOLDER_ID: '',

  /** Label applied to the rewritten message so it won't be processed again. */
  PROCESSED_LABEL: 'bijlagen-verwerkt',

  /** Maximum number of emails to process per run (prevents Apps Script 6-minute timeout). */
  BATCH_SIZE: 10,

  /** Whether to actually execute destructive actions (trash messages). Set to false for dry-run testing. */
  DRY_RUN: false,

  /** Whether to actually move original messages to trash. Override in dry-run mode. */
  TRASH_MESSAGES: true,
};

// ─── DRIVE INTEGRATION ────────────────────────────────────────────────────────

/**
 * Returns the Google Drive folder used for attachment backups.
 * If DRIVE_FOLDER_ID is set, looks up that folder directly.
 * Otherwise, looks up (or creates) a folder by DRIVE_FOLDER_NAME.
 *
 * @returns {GoogleAppsScript.Drive.Folder} The backup folder
 * @throws {Error} If the folder ID is specified but not found
 */
function getOrCreateBackupFolder() {
  if (CONFIG.DRIVE_FOLDER_ID) {
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    if (!folder) {
      throw new Error(`Drive folder with ID "${CONFIG.DRIVE_FOLDER_ID}" not found.`);
    }
    Logger.log('[DRIVE] Using folder by ID: ' + CONFIG.DRIVE_FOLDER_ID);
    return folder;
  }

  const folders = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log('[DRIVE] Found existing folder: "' + CONFIG.DRIVE_FOLDER_NAME + '" (ID: ' + folder.getId() + ')');
    return folder;
  }

  // Folder doesn't exist — create it
  const folder = DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
  Logger.log('[DRIVE] Created new folder: "' + CONFIG.DRIVE_FOLDER_NAME + '" (ID: ' + folder.getId() + ')');
  return folder;
}

/**
 * Generates a unique filename within the backup folder.
 * If a file with the same name already exists, appends the thread ID
 * (or a timestamp) to the filename to avoid collisions.
 *
 * @param {string} originalName - The original attachment filename
 * @param {string} threadId - The Gmail thread ID (used for disambiguation)
 * @param {GoogleAppsScript.Drive.Folder} folder - The Drive folder
 * @returns {string} A unique filename safe for Drive
 */
function getUniqueFilename(originalName, threadId, folder) {
  // Check if a file with this name already exists in the folder
  const existing = folder.getFilesByName(originalName);
  if (existing.hasNext()) {
    // A file with the same name already exists — append thread ID for uniqueness
    const ext = getExtension(originalName);
    const base = originalName.slice(0, -(ext ? ext.length + 1 : 0));
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const newName = `${base}_${timestamp}_${threadId.substring(0, 8)}${ext ? '.' + ext : ''}`;
    Logger.log('[DRIVE] Name collision: "' + originalName + '" → "' + newName + '"');
    return newName;
  }
  return originalName;
}

/**
 * Extracts the file extension (without dot) from a filename.
 *
 * @param {string} filename
 * @returns {string} Extension without dot, or empty string if none
 */
function getExtension(filename) {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return ''; // No dot, or dot is the first char (hidden file)
  return filename.slice(lastDot + 1);
}

/**
 * Saves an attachment to the backup Drive folder.
 *
 * @param {GoogleAppsScript.Gmail.Attachment} attachment
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} threadId
 * @returns {{name: string, size: number, driveId: string}} Metadata about the saved file
 */
function saveAttachment(attachment, folder, threadId) {
  const originalName = attachment.getName();
  const uniqueName = getUniqueFilename(originalName, threadId, folder);
  const blob = attachment.copyBlob();
  blob.setName(uniqueName);
  const file = folder.createFile(blob);
  Logger.log('[DRIVE] Saved: "' + uniqueName + '" (' + file.getSize() + ' bytes)');
  return {
    name: uniqueName,
    size: file.getSize(),
    driveId: file.getId(),
  };
}

// ─── MESSAGE REWRITING (Advanced Gmail API) ──────────────────────────────────

/**
 * Fetches the raw RFC 2822 message from Gmail via the Advanced Gmail API.
 * Returns the raw message as a string, with the original internal date preserved.
 *
 * @param {string} messageId - Gmail message ID
 * @returns {string} Raw RFC 2822 message
 */
function getRawMessage(messageId) {
  return Gmail.Users.Messages.get('me', messageId, {
    format: 'raw',
  }).raw;
}

/**
 * Strips all MIME parts that are attachments from a raw RFC 2822 message,
 * preserving the text and HTML content of the message body.
 *
 * The approach: parse the message structure, identify the text/html body parts
 * (the non-attachment parts), and rebuild a clean multipart/alternative message
 * containing only those parts plus the note about removed attachments.
 *
 * @param {string} rawMessage - Raw RFC 2822 message (base64 encoded by Gmail API)
 * @param {string[]} attachmentNames - List of attachment filenames removed (for the note)
 * @returns {string} Base64-encoded clean RFC 2822 message
 */
/**
 * Decodes a Gmail API raw message (base64url) to bytes.
 * Gmail API returns base64url-encoded RFC 2822 messages; Utilities.base64Decode
 * expects standard base64 (with + and /), so we convert first.
 *
 * @param {string} rawMessage - base64url-encoded RFC 2822 message
 * @returns {byte[]} Decoded message bytes
 */
function decodeRawMessage(rawMessage) {
  const standardBase64 = rawMessage.replace(/-/g, '+').replace(/_/g, '/');
  return Utilities.base64Decode(standardBase64);
}

function stripAttachmentsFromRaw(rawMessage, attachmentNames) {
  // Gmail API returns raw messages as base64url-encoded RFC 2822 message.
  const decoded = decodeRawMessage(rawMessage);
  const messageString = Utilities.newBlob(decoded).getDataAsString();

  // Parse the message: extract headers and body
  const headerEnd = messageString.indexOf('\r\n\r\n');
  const headers = messageString.substring(0, headerEnd);
  const body = messageString.substring(headerEnd + 4);

  // Check if the message is multipart (most likely if it has attachments)
  if (!body.startsWith('------=_')) {
    // Non-multipart message — no attachments to strip, return as-is
    Logger.log('[REBUILD] Message is not multipart, returning original');
    return rawMessage;
  }

  // Split into MIME parts
  const boundaryMatch = headers.match(/boundary="?([^";\s]+)"?/i);
  if (!boundaryMatch) {
    Logger.log('[REBUILD] No boundary found, returning original');
    return rawMessage;
  }
  const boundary = boundaryMatch[1];
  const parts = body.split('--' + boundary);

  const keptParts = [];
  const attachmentNote = buildAttachmentNote(attachmentNames);

  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') continue;

    // Check if this part is an attachment (has Content-Disposition: attachment)
    const dispositionMatch = part.match(/Content-Disposition:\s*attachment/i);
    if (dispositionMatch) {
      // This is an attachment — skip it (it's already saved to Drive)
      const nameMatch = part.match(/filename="?([^"]+)"?/i);
      const filename = nameMatch ? nameMatch[1] : 'unknown';
      Logger.log('[REBUILD] Stripping attachment: "' + filename + '"');
      continue;
    }

    // Check for inline attachments (Content-Disposition: inline with filename)
    const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentDispMatch = part.match(/Content-Disposition:\s*(inline)/i);
    // If it's an inline part with a filename, it might be a CID-attached image.
    // For now, keep these to preserve HTML formatting with embedded images.
    // But if it has a filename AND is multipart-related, it could be an attachment.
    // We keep inline parts to preserve the email's appearance.
    if (contentDispMatch && part.match(/filename=/i)) {
      // Inline with filename — could be an embedded image. Keep it for now.
      keptParts.push(part);
      continue;
    }

    // Not an attachment — keep this part
    keptParts.push(part);
  }

  // Rebuild the message body with remaining parts + attachment note
  // Reconstruct the MIME structure
  let newBody = '';
  for (const part of keptParts) {
    newBody += '--' + boundary + '\r\n' + part.trim() + '\r\n';
  }
  newBody += '--' + boundary + '--\r\n';

  // Append the attachment note to the text/plain part
  newBody = appendNoteToTextPart(newBody, attachmentNote);

  // Rebuild full message
  const newMessage = headers + '\r\n\r\n' + newBody;
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(newMessage).getBytes());
}

/**
 * Builds a human-readable note listing removed attachments.
 *
 * @param {string[]} attachmentNames
 * @returns {string} HTML + plain text note
 */
function buildAttachmentNote(attachmentNames) {
  const lines = ['Met bijlage(n) weggehaald en opgeslagen in Google Drive:'];
  attachmentNames.forEach(name => {
    lines.push('[Bijlage "' + name + '" verwijderd en opgeslagen in Google Drive]');
  });
  return lines.join('\n');
}

/**
 * Appends a note to the text/plain part of the rebuilt MIME message.
 * Finds the first text/plain part and appends the note before the closing boundary.
 *
 * @param {string} body - The MIME body string
 * @param {string} note - The note text to append
 * @returns {string} Modified body
 */
function appendNoteToTextPart(body, note) {
  // For simplicity, we append the note as a separate text/plain part
  // This is safe and ensures the note is always visible
  const boundaryMatch = body.match(/--([a-f0-9]+)/);
  if (!boundaryMatch) return body;
  const boundary = boundaryMatch[1];

  const notePart = [
    '--' + boundary,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    'Content-Disposition: inline',
    '',
    '',
    note,
    '',
    '--' + boundary + '--',
  ].join('\r\n');

  return body.replace(new RegExp('--' + boundary + '--'), notePart);
}

/**
 * Inserts a rewritten (attachment-free) copy of the message into the same thread
 * using the Advanced Gmail API. Uses internalDateSource: "dateHeader" to preserve
 * the original send date.
 *
 * @param {string} rawMessage - The clean (attachment-free) RFC 2822 message, base64url-encoded
 * @param {string} threadId - The Gmail thread ID to append to
 * @param {GoogleAppsScript.Gmail.Label} processedLabel - Label to apply to the new message
 * @returns {object} The inserted message result from Gmail API
 */
function insertRewrittenMessage(rawMessage, threadId, processedLabel) {
  const labelId = processedLabel ? processedLabel.getId() : null;
  const resource = labelId ? { labelIds: [labelId] } : {};
  const options = { threadId: threadId, internalDateSource: 'dateHeader' };
  if (labelId) options.addLabelIds = [labelId];

  const result = Gmail.Users.Messages.insert(resource, rawMessage, options);

  Logger.log('[REBUILD] Inserted rewritten message into thread ' + threadId + ' (new message ID: ' + result.id + ')');
  return result;
}

// ─── MAIN PROCESSING LOGIC ────────────────────────────────────────────────────

/**
 * Processes emails with large attachments:
 *   1. Finds emails matching the SEARCH_QUERY
 *   2. Saves all attachments to Google Drive
 *   3. Creates a clean copy (without attachments) preserving metadata
 *   4. Trashes the original message
 *   5. Labels the new message as processed
 *
 * Uses BATCH_SIZE to limit processing per run and prevent timeouts.
 *
 * @param {GoogleAppsScript.Gmail.GmailThread[]} [threads] - Optional pre-fetched threads (e.g. from dryRun)
 * @returns {{processed: number, totalAttachments: number, totalBytes: number, errors: string[]}}
 */
function processAttachments(threads) {
  Logger.log('=== GmailAttachmentCleaner.start ===');
  const startTime = new Date();

  const folder = getOrCreateBackupFolder();
  // No processed label — so adjusting the 10MB limit won't skip messages
  const processedLabel = null;

  if (!threads) {
    threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.BATCH_SIZE);
  }
  // Sort oldest first (by first message date)
  threads.sort((a, b) => {
    const msgA = a.getMessages()[0];
    const msgB = b.getMessages()[0];
    return msgA.getDate().getTime() - msgB.getDate().getTime();
  });
  Logger.log('[SEARCH] Found ' + threads.length + ' thread(s) to process (batch size: ' + CONFIG.BATCH_SIZE + ')');

  let processed = 0;
  let totalAttachments = 0;
  let totalBytes = 0;
  const errors = [];

  threads.forEach((thread, index) => {
    const threadId = thread.getId();
    Logger.log('[PROCESS] ' + (index + 1) + '/' + threads.length + ' — Thread: ' + threadId);

    try {
      const messages = thread.getMessages();
      for (const message of messages) {
        // Only process messages that actually have attachments
        const attachments = message.getAttachments();
        if (attachments.length === 0) continue;

        const messageId = message.getId();
        Logger.log('[PROCESS] Message ID: ' + messageId + ' — Subject: ' + message.getSubject() + ' — Attachments: ' + attachments.length);

        const msgDate = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        const safeSubject = (message.getSubject() || 'geen-onderwerp').replace(/[\\/:*?"<>|]/g, '-');
        const subfolderName = msgDate + ' - ' + safeSubject;
        const emailFolder = folder.createFolder(subfolderName);
        Logger.log('[DRIVE] Email folder: ' + subfolderName);

        // 1. Save original .eml + attachments to email subfolder
        const savedFiles = [];
        const rawMessage = getRawMessage(messageId);
        const emlBlob = Utilities.newBlob(decodeRawMessage(rawMessage)).setName(subfolderName + '.eml');
        emailFolder.createFile(emlBlob);
        Logger.log('[DRIVE] Saved .eml: ' + subfolderName + '.eml');

        for (const attachment of attachments) {
          const saved = saveAttachment(attachment, emailFolder, threadId);
          savedFiles.push(saved);
          totalAttachments++;
          totalBytes += saved.size;
        }

        // 2. Strip attachments from already-fetched raw message
        const attachmentNames = attachments.map(a => a.getName());
        const cleanRaw = stripAttachmentsFromRaw(rawMessage, attachmentNames);

        // 3. Insert the rewritten message back into the same thread
        insertRewrittenMessage(cleanRaw, threadId, processedLabel);

        // 4. Trash the original message (with heavy attachments)
        if (CONFIG.DRY_RUN || !CONFIG.TRASH_MESSAGES) {
          Logger.log('[SKIP] DRY_RUN mode — original message NOT trashed');
        } else {
          GmailApp.trashMessage(message);
          Logger.log('[TRASH] Original message trashed: ' + messageId);
        }

        // 5. No label added (so 10MB limit stays adjustable)
        // (label intentionally removed — see user's instruction)

        processed++;
      }
    } catch (err) {
      const errorDetail = threadId + ': ' + err.message;
      errors.push(errorDetail);
      Logger.log('[ERROR] ' + errorDetail);
      // Continue with next thread — don't let one failure crash everything
    }
  });

  const elapsedSec = Math.round((new Date() - startTime) / 1000);
  const freedMB = (totalBytes / (1024 * 1024)).toFixed(2);

  Logger.log('=== GmailAttachmentCleaner.complete ===');
  Logger.log('[SUMMARY] Processed: ' + processed + '/' + threads.length + ' messages');
  Logger.log('[SUMMARY] Attachments saved: ' + totalAttachments + ', total: ' + freedMB + ' MB');
  Logger.log('[SUMMARY] Errors: ' + errors.length);
  Logger.log('[SUMMARY] Elapsed: ' + elapsedSec + 's');

  if (errors.length > 0) {
    Logger.log('[ERRORS] ' + errors.join('\n'));
  }

  return { processed, totalAttachments, totalBytes, errors };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Gets a Gmail user label by name, creating it if it doesn't exist.
 *
 * @param {string} name - Label name
 * @returns {GoogleAppsScript.Gmail.Label}
 */
function getOrCreateLabel(name) {
  try {
    return GmailApp.getUserLabelByName(name);
  } catch (e) {
    return GmailApp.createLabel(name);
  }
}

/**
 * Runs a single test iteration with verbose logging.
 * Processes only ONE thread — safe for manual testing.
 */
/**
 * Test runner: verifieert GmailApp-integratie en draait alle core tests.
 * Handig voor `clasp run test`.
 */
function test() {
  Logger.log('=== GmailApp integratie check ===');
  const hasGmailApp = typeof GmailApp !== 'undefined' && typeof GmailApp.search === 'function';
  Logger.log('GmailApp beschikbaar: ' + hasGmailApp);
  Logger.log('GmailApp.search: ' + typeof GmailApp.search);
  Logger.log('=== Core tests ===');
  if (typeof runAllCoreTests === 'function') {
    runAllCoreTests();
  } else {
    Logger.log('runAllCoreTests niet gevonden (TestCore.gs mogelijk niet geladen).');
  }
}

function dryRun() {
  CONFIG.DRY_RUN = true;
  Logger.log('[DRY-RUN] Running oldest-first, max 1, >10MB attachment');
  // Sort oldest first, limit to 1 for safe manual test
  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.BATCH_SIZE);
  threads.sort((a, b) => {
    const msgA = a.getMessages()[0];
    const msgB = b.getMessages()[0];
    return msgA.getDate().getTime() - msgB.getDate().getTime();
  });
  if (threads.length > 1) threads.splice(1);
  Logger.log('[DRY-RUN] Testing oldest of ' + threads.length + ' thread(s)');
  processAttachments(threads);
  CONFIG.DRY_RUN = false;
}

/**
 * Prints a summary of emails that would be processed without taking any action.
 * Safe to run anytime — read-only.
 */
function previewAttachments() {
  Logger.log('[PREVIEW] Searching for large attachments...');
  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.BATCH_SIZE);
  Logger.log('[PREVIEW] Found ' + threads.length + ' thread(s)');

  let totalAttachments = 0;
  let totalBytes = 0;

  threads.forEach(thread => {
    const messages = thread.getMessages();
    messages.forEach(message => {
      const attachments = message.getAttachments();
      if (attachments.length > 0) {
        attachments.forEach(a => {
          const size = a.getSize();
          totalAttachments++;
          totalBytes += size;
          Logger.log('[PREVIEW] "' + a.getName() + '" — ' + (size / 1024 / 1024).toFixed(2) + ' MB — in: ' + message.getSubject());
        });
      }
    });
  });

  Logger.log('[PREVIEW] Total: ' + totalAttachments + ' attachment(s), ' + (totalBytes / (1024 * 1024)).toFixed(2) + ' MB');
}
// ─── TRIGGER MANAGEMENT ───────────────────────────────────────────────────────

/**
 * Creates an hourly trigger to run processAttachments automatically.
 * Call once manually to enable periodic cleanup of large attachments.
 */
function setupTrigger() {
  // Remove any existing triggers first to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processAttachments')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('[TRIGGER] Hourly processAttachments trigger created.');
}

/**
 * Removes all project triggers (use to stop automatic processing).
 */
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('[TRIGGER] All triggers removed.');
}
