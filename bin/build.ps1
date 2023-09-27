# Development build functions for Amalgam vscode extension
#
# usage: ./bin/build.ps1 <build-function> {params}
#####

param(
  [Parameter()]
  [string]$func
)

$PACKAGE = Get-Content "package.json" | Out-String | ConvertFrom-Json

$VERSION=$PACKAGE.version
$PACKAGE_NAME="amalgam-lang-$VERSION.vsix"

# Package extension files
function Package-Extension() {
  Remove-Item -LiteralPath "$PACKAGE_NAME" -Force -ErrorAction SilentlyContinue
  npm run "vscode:package"
}

# Package extension bundle and install it
function Install-Extension() {
  if (Get-Command "code" -errorAction SilentlyContinue) {
    Package-Extension
    code --install-extension $PACKAGE_NAME
  } else {
    Write-Host "VSCode 'code' command not found, is it installed?" -ForegroundColor red
    exit 1
  }
}

if ($func.Length -eq 0) {
  echo "Usage: ./bin/build.ps1 <build-function> {params}"
  echo " Where <build-function> one of :-"
  echo "    package"
  echo "    install"
} elseif ($func -eq "package") {
  Package-Extension
} elseif ($func -eq "install") {
  Install-Extension
}