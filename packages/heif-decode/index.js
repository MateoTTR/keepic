// Try to load prebuild first, fall back to compiled build
let binding

try {
  binding = require('node-gyp-build')(__dirname)
} catch {
  // Fallback: try loading from default node-gyp build location
  binding = require('./build/Release/heif_decode.node')
}

module.exports = binding
