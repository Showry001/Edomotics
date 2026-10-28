#!/bin/sh
# Regenerates the review document from the website source, without touching the site:
#   1. builds the site into a temporary folder,
#   2. extracts every piece of text into build/extracted-content.json,
#   3. writes the Word document,
#   4. checks the document against the extracted text,
#   5. exports the PDF preview (needs Apple Pages; LibreOffice is not installed here).
# Usage (from docs/content-review): npm run build
#   SITE_DATE=YYYY-MM-DD  date the reviewed version was published (shown on the cover)
#   SKIP_PDF=1            skip the PDF preview
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
SITE=$(cd "$ROOT/../.." && pwd)
DOC="$ROOT/Website_Content_Sitemap_and_Review_v1.0"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "1/5 building the site into a temporary folder"
(cd "$SITE" && npx vite build --outDir "$TMP/site" --emptyOutDir --logLevel error)

echo "2/5 extracting the content"
python3 "$HERE/extract_content.py" "$TMP/site" "$ROOT/build/extracted-content.json"

echo "3/5 writing the Word document"
node "$HERE/build_docx.mjs"

echo "4/5 checking the document against the extracted content"
python3 "$HERE/verify_docx.py" "$DOC.docx" "$ROOT/build/extracted-content.json" --site "$TMP/site"

if [ -z "$SKIP_PDF" ]; then
  echo "5/5 exporting the PDF preview with Apple Pages (LibreOffice is not installed)"
  osascript "$HERE/export_pdf.applescript" "$DOC.docx" "$DOC.pdf"
fi
