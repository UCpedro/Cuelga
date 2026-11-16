#!/bin/sh
# Xcode Cloud: genera lo que no está en Git (node_modules, dist, ios/App/App/public) antes de compilar.
set -euo pipefail
cd "$CI_PRIMARY_REPOSITORY_PATH"
MOBILE="$(dirname "$(find . -maxdepth 3 -name capacitor.config.ts -not -path '*/node_modules/*' | head -1)")"
cd "$MOBILE"
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version
npm ci
npm run typecheck
npm test
npm run ios:prepare   # build web + cap sync ios (en producción: avisos APNs 'production')
