#!/bin/bash
# Run dryRun and capture logs
# Usage: ./scripts/run-dryrun.sh

cd /home/aldo/dev/06-apps-script-google/LabelReminder

echo "Starting dryRun..."
echo "========================================"

# Run the function and capture output
clasp run dryRun 2>&1

echo ""
echo "========================================"
echo "Checking logs..."
echo ""

# Capture recent logs
clasp tail-logs --simplified 2>&1 | head -100
