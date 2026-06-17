#!/bin/bash
# muc.io - Update and Launch (macOS)
# Double-click this file in Finder to start. Terminal will open automatically.

# Add common Node.js install locations to PATH
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin"

# Source nvm if installed (common Node version manager)
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"

# Always run from this script's own folder
cd "$(dirname "$0")"

echo ""
echo "================================================"
echo "  muc.io  |  Investigation Toolkit"
echo "================================================"
echo ""
echo "  Working folder: $(pwd)"
echo ""

# -- Check for Git --
echo "  Checking for Git..."
if ! git --version 2>/dev/null; then
  echo ""
  echo "  [ERROR] Git is not installed."
  echo "  Run this in Terminal:  xcode-select --install"
  echo "  Or download from:      https://git-scm.com/"
  echo ""
  read -rp "  Press Enter to close..."
  exit 1
fi

# -- Check for Node.js --
echo ""
echo "  Checking for Node.js..."
if ! node --version 2>/dev/null; then
  echo ""
  echo "  [ERROR] Node.js is not installed."
  echo "  Download the LTS version from: https://nodejs.org/"
  echo ""
  read -rp "  Press Enter to close..."
  exit 1
fi

echo ""
echo "  ------------------------------------------------"
echo "  [1/3]  Pulling latest updates..."
echo ""
git pull origin claude/predator-investigation-support-xd2lk6 2>&1 \
  || echo "  [~] Could not pull updates. Starting with local files."

echo ""
echo "  ------------------------------------------------"
echo "  [2/3]  Installing dependencies..."
echo ""
npm install
if [ $? -ne 0 ]; then
  echo ""
  echo "  [ERROR] npm install failed. See error above."
  echo ""
  read -rp "  Press Enter to close..."
  exit 1
fi

echo ""
echo "  ------------------------------------------------"
echo "  [3/3]  Starting server..."
echo ""
echo "  +-------------------------------------------+"
echo "  |                                           |"
echo "  |  Browser opening: http://localhost:3000   |"
echo "  |                                           |"
echo "  |  Keep this window open while you work.   |"
echo "  |  Press Ctrl+C to stop the server.        |"
echo "  |                                           |"
echo "  +-------------------------------------------+"
echo ""

# Open the browser after the server has had a moment to start
(sleep 3 && open http://localhost:3000) &

# Run the server directly — control returns here when it stops
node server.js

echo ""
echo "  ------------------------------------------------"
echo "  Server stopped."
echo ""
read -rp "  Press Enter to close..."
