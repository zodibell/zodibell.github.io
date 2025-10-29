#!/bin/bash

echo "🔍 Searching for index.html files in tag folders..."

# Find and delete index.html files inside tags/<tag>/ folders
find tags -type f -name "index.html" -exec rm -v {} \;

echo "✅ Cleanup complete. All index.html files in 'tags/' subfolders have been removed."