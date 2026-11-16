#!/bin/sh
# Xcode Cloud: genera lo que no está en Git (node_modules, dist, ios/App/App/public) antes de compilar.
set -euo pipefail
cd "$CI_PRIMARY_REPOSITORY_PATH"
MOBILE="$(dirname "$(find . -maxdepth 3 -name capacitor.config.ts -not -path '*/node_modules/*' | head -1)")"
MOBILE="$(cd "$MOBILE" && pwd)"; cd "$MOBILE"
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version
npm ci
npm run typecheck
npm test
npm run ios:prepare   # build web + cap sync ios (en producción: avisos APNs 'production')

# Cada build subido a App Store Connect necesita un número distinto.
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  cd "$CI_PRIMARY_REPOSITORY_PATH"
  sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;/" "$MOBILE/ios/App/App.xcodeproj/project.pbxproj"
fi
