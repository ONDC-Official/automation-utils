#!/bin/bash

BUILD_PATH=$1
OUTPUT_PATH=$2

echo "Running L1 validation generator..."

# Try local installation first
if [ -f "./node_modules/.bin/ondc-code-generator" ]; then
    echo "Using local installation"
    chmod +x ./node_modules/.bin/ondc-code-generator 2>/dev/null || true
    ./node_modules/.bin/ondc-code-generator xval -c "$BUILD_PATH" -o "$OUTPUT_PATH" -l rag_table
else
    echo "Using npx"
    npx --yes ondc-code-generator xval -c "$BUILD_PATH" -o "$OUTPUT_PATH" -l rag_table
fi