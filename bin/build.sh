#!/bin/bash
#
# Development build functions for Amalgam vscode extension
#
# usage: ./bin/build.sh <build-function> {params}
#
#####

set -eu # fail on error, and undefined var usage

VERSION=$(jq -r '.version' package.json)
PACKAGE_NAME="howso.amalgam-lang-$VERSION"

VSCODE_DIR=~/.vscode/extensions
BUILD_DIR="./build"
PACKAGE_DIR="$BUILD_DIR/$PACKAGE_NAME"

# Run build process
build() {
  npm run build
}

# Package extension files
package() {
  rm -rf $BUILD_DIR
  mkdir -p $PACKAGE_DIR
  cp -r themes syntaxes snippets images configuration dist .vsixmanifest .vscodeignore package.json LICENSE.txt README.md $PACKAGE_DIR
  echo "package built at $PACKAGE_DIR"
}

# Package extension bundle and install it
install() {
  if [ -d "$VSCODE_DIR" ]; then
    package
    rm -rf $VSCODE_DIR/$PACKAGE_NAME
    cp -r "$PACKAGE_DIR" "$VSCODE_DIR"
    echo "extension installed"
  else
    echo "$VSCODE_DIR directory not found"
  fi
}

# Build and install
build_install() {
  build
  install
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
