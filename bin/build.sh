#!/bin/bash
#
# Development build functions for Amalgam vscode extension
#
# usage: ./bin/build.sh <build-function> {params}
#
#####

set -eu # fail on error, and undefined var usage

VERSION=$(jq -r '.version' package.json)
PACKAGE_NAME="amalgam-lang-$VERSION.vsix"
RED='\033[0;31m'
NC='\033[0m'

# Package extension files
package() {
  rm -f "$PACKAGE_NAME"
  npm run vscode:package
}

# Package extension bundle and install it
install() {
  if command -v code &> /dev/null; then
    package
    code --install-extension $PACKAGE_NAME
  else
    echo -e "${RED}VSCode 'code' command not found, is it installed?${NC}"
    exit 1
  fi
}

# Show usage, and print functions
help() {
  echo "usage: ./bin/build.sh <build-function> {params}"
  echo " where <build-function> one of :-"
  IFS=$'\n'
  for f in $(declare -F); do
  echo "    ${f:11}"
  done
}

# Takes the cli params, and runs them, defaulting to 'help()'
if [ ! ${1:-} ]; then
  help
else
  "$@"
fi
