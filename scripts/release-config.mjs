export function unsignedReleaseGradle(source) {
  const release = /\brelease\s*\{[^}]*\bsigningConfig signingConfigs\.debug/;
  if (!release.test(source)) throw new Error('Unexpected generated release signing configuration. Inspect it before proceeding.');
  return source.replace(release, (block) => block.replace('signingConfig signingConfigs.debug', 'signingConfig null'));
}
