param(
  [Parameter()]
  [string]$func
)

$PACKAGE = Get-Content "package.json" | Out-String | ConvertFrom-Json

$VERSION=$PACKAGE.version
$PACKAGE_NAME="howso.amalgam-lang-$VERSION"

$VSCODE_DIR="~/.vscode/extensions"
$BUILD_DIR="./build"
$PACKAGE_DIR="$BUILD_DIR/$PACKAGE_NAME"

# Build extension files
function Build-Extension() {
  npm run build
}

# Package extension files
function Package-Extension() {
  if (Test-Path "$BUILD_DIR") {
    Remove-Item -LiteralPath "$BUILD_DIR" -Force -Recurse
  }
  New-Item -Path "$PACKAGE_DIR" -Type Directory
  $targets = @(
    "themes",
    "syntaxes",
    "snippets",
    "images",
    "dist",
    "configuration",
    ".vsixmanifest",
    ".vscodeignore",
    "package.json",
    "LICENSE.txt",
    "README.md"
  )
  Foreach ($path in $targets) {
    Copy-Item -Path "$path" -Destination "$PACKAGE_DIR" -Recurse -Force
  }
  echo "Package built at $PACKAGE_DIR"
}

# Package extension bundle and install it
function Install-Extension() {
  if (Test-Path "$VSCODE_DIR") {
    Package-Extension
    if (Test-Path "$VSCODE_DIR/$PACKAGE_NAME") {
      Remove-Item -LiteralPath "$VSCODE_DIR/$PACKAGE_NAME" -Force -Recurse
    }
    Copy-Item -Path "$PACKAGE_DIR" -Destination "$VSCODE_DIR" -Recurse -Force
    echo "Extension installed"
  } else {
    echo "$VSCODE_DIR directory not found"
  }
}

if ($func.Length -eq 0) {
  echo "Usage: ./bin/build.ps1 <build-function> {params}"
  echo " Where <build-function> one of :-"
  echo "    build"
  echo "    package"
  echo "    install"
} elseif ($func -eq "build") {
  Build-Extension
} elseif ($func -eq "package") {
  Package-Extension
} elseif ($func -eq "install") {
  Install-Extension
}