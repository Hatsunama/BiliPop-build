const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Bound bundler concurrency on shared, memory-constrained build machines.
config.maxWorkers = 1;
config.resolver.assetExts.push('modeldata');
module.exports = config;
