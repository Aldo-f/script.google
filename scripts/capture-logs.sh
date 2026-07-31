#!/bin/bash
# Log capture script for LabelReminder
# Usage: ./scripts/capture-logs.sh [output_file]

LOG_DIR="/home/aldo/dev/06-apps-script-google/logs"
OUTPUT_FILE="${1:-$LOG_DIR/LabelReminder_$(date +%Y%m%d_%H%M%S).log}"

mkdir -p "$LOG_DIR"

echo "Capturing logs to: $OUTPUT_FILE"
echo "Timestamp: $(date)"
echo "========================================" >> "$OUTPUT_FILE"

# Capture logs
clasp tail-logs --simplified 2>&1 >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"
echo "========================================" >> "$OUTPUT_FILE"
echo "Captured at: $(date)" >> "$OUTPUT_FILE"

echo "Logs saved to: $OUTPUT_FILE"
cat "$OUTPUT_FILE"
