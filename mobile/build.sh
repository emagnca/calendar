#!/usr/bin/env bash
# build.sh — copies the webapp client into www/ and applies mobile patches.
# Run from the mobile/ directory: bash build.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/../client"
export WWW_DIR="$SCRIPT_DIR/www"

# Lambda backend URL (no trailing slash)
export API_URL="https://mr3xmgyqnxzrszocyvutnjknty0eodkp.lambda-url.eu-north-1.on.aws"

echo "→ Copying client files to www/..."
rsync -a --delete \
    --exclude="public/index.html" \
    "$CLIENT_DIR/" "$WWW_DIR/"

echo "→ Patching www/index.html..."
python3 - <<'PYEOF'
import re, os

path = os.path.join(os.environ.get('WWW_DIR', 'www'), 'index.html')
api_url = os.environ.get('API_URL', '')

with open(path) as f:
    html = f.read()

# 1. Remove <base href="/">
html = re.sub(r'\s*<base href="/">', '', html)

# 2. Replace relative API base URL with absolute Lambda URL
html = html.replace(
    "axios.defaults.baseURL = '/api';",
    f"axios.defaults.baseURL = '{api_url}/api';"
)

# 3. Inject mobile-patch.js before script.js
html = html.replace(
    '<script src="script.js"></script>',
    '<script src="mobile-patch.js"></script>\n<script src="script.js"></script>'
)

with open(path, 'w') as f:
    f.write(html)

print('  index.html patched.')
PYEOF

echo "→ Patching www/script.js..."
python3 - <<'PYEOF'
import os

path = os.path.join(os.environ.get('WWW_DIR', 'www'), 'script.js')

with open(path) as f:
    src = f.read()

original = "const currentGroup = window.location.pathname.split('/').filter(Boolean)[0] || null;"
patched  = "const currentGroup = window._mobileGroup || window.location.pathname.split('/').filter(Boolean)[0] || null;"

if original in src:
    src = src.replace(original, patched)
    with open(path, 'w') as f:
        f.write(src)
    print('  script.js patched.')
else:
    print('  WARNING: expected line not found in script.js — patch skipped.')
PYEOF

echo "✓ Build complete. Run 'npx cap sync' to push to iOS/Android."
