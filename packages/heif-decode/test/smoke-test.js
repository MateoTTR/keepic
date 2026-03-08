#!/usr/bin/env node
// Smoke test: load the addon, decode a HEIC file, verify output.
'use strict';

const path = require('path');
const fs = require('fs');
const addon = require('../');

const samplePath = path.join(__dirname, 'sample.heic');
const buf = fs.readFileSync(samplePath);

// 1. getInfo — read dimensions without decoding
const info = addon.getInfo(buf);
console.log(`getInfo: ${info.width}x${info.height}, alpha=${info.hasAlphaChannel}`);
if (info.width <= 0 || info.height <= 0) {
  console.error('FAIL: invalid dimensions from getInfo');
  process.exit(1);
}

// 2. decode — synchronous RGBA decode
const rgba = addon.decode(buf);
const expectedLen = info.width * info.height * (info.hasAlphaChannel ? 4 : 4);
console.log(`decode: ${rgba.length} bytes (expected ${expectedLen})`);
if (rgba.length !== expectedLen) {
  console.error(`FAIL: decode output size mismatch (got ${rgba.length}, expected ${expectedLen})`);
  process.exit(1);
}

// 3. Apple HDR HEIC (iOS 18+ with gain map) — previously failed with libheif 1.17.6
const hdrPath = path.join(__dirname, 'sample-hdr.heic');
const hdrBuf = fs.readFileSync(hdrPath);

const hdrInfo = addon.getInfo(hdrBuf);
console.log(`getInfo (HDR): ${hdrInfo.width}x${hdrInfo.height}, alpha=${hdrInfo.hasAlphaChannel}`);
if (hdrInfo.width <= 0 || hdrInfo.height <= 0) {
  console.error('FAIL: invalid dimensions from getInfo (HDR)');
  process.exit(1);
}

const hdrRgba = addon.decode(hdrBuf);
const hdrExpectedLen = hdrInfo.width * hdrInfo.height * 4;
console.log(`decode (HDR): ${hdrRgba.length} bytes (expected ${hdrExpectedLen})`);
if (hdrRgba.length !== hdrExpectedLen) {
  console.error(`FAIL: decode output size mismatch (HDR) (got ${hdrRgba.length}, expected ${hdrExpectedLen})`);
  process.exit(1);
}

console.log('PASS: smoke test OK');
