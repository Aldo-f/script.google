#!/bin/bash
# Log capture script for LabelReminder
# Usage: ./scripts/capture-logs.sh [output_file]

LOG_DIR="/home/aldo/dev/06-apps-script-google/logs"
OUTPUT_FILE="${1:-$LOG_DIR/LabelReminder_$(date +%Y%m%d_%H%M%S).log}"

mkdir -p "$LOG_DIR"

echo "Capturing logs to: $OUTPUT_FILE"
echo "Timestamp: $(date)"
echo "========================================" >> "$OUTPUT_FILE"

# Capture logs (full output, no truncation)
clasp tail-logs --simplified 2>&1 >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "========================================" >> "$OUTPUT_FILE"
echo "Captured at: $(date)" >> "$OUTPUT_FILE"

echo "Logs saved to: $OUTPUT_FILE"
echo ""
echo "=== SUMMARY ==="
echo "Total lines: $(wc -l < "$OUTPUT_FILE")"
echo "DRAFTs: $(grep -c 'DRAFT' "$OUTPUT_FILE")"
echo "SENTs: $(grep -c 'SENT' "$OUTPUT_FILE")"
echo "Body previews: $(grep -c 'Body:' "$OUTPUT_FILE")"
echo ""
echo "=== LATEST ENTRIES ==="
tail -30 "$OUTPUT_FILE"
