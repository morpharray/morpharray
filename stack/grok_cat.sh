#!/bin/bash
# grok_cat.sh - Dump the content of the main source files to clipboard for Grok
# Usage: ./grok_cat.sh

set -euo pipefail

echo "=== Grok Cat - Source Files Dump ===" >&2
echo "Dumping src/ TypeScript files to clipboard..." >&2

{
    echo "================================================================="
    echo "GROK CAT - MORPHARRAY EXTENSION SOURCE FILES"
    echo "Generated: $(date)"
    echo "================================================================="
    echo ""

    # List of files to dump
    files=(
        "src/extension.ts"
        "src/siteBuilder.ts"
        "src/mentalStack.ts"
        "src/utils.ts"
    )

    for file in "${files[@]}"; do
        if [[ -f "$file" ]]; then
            echo "================================================================="
            echo "FILE: $file"
            echo "================================================================="
            echo ""
            cat "$file"
            echo ""
            echo ""
        else
            echo "================================================================="
            echo "FILE: $file"
            echo "================================================================="
            echo "ERROR: File not found"
            echo ""
            echo ""
        fi
    done

    echo "================================================================="
    echo "End of source files dump"
    echo "Total files processed: ${#files[@]}"

} | tee "/tmp/grok_cat_source.md" | pbcopy

echo ""
echo "✅ Done!"
echo "   • Source files dumped to clipboard"
echo "   • Also saved to: /tmp/grok_cat_source.md"
echo ""
echo "You can now paste directly into the chat."