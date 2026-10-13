// Kotlin 2.3.20 reads LiteRT-LM 0.17.1's non-strict 2.4 metadata without bypasses
// and has a published Pika 0.3.2 compiler artifact; Kotlin 2.4.0 does not.
// Align Expo's catalog AND root classpath; the property alone leaves RN's KGP 2.1.20.
const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');
const KOTLIN_VERSION = '2.3.20';

module.exports = (config) => {
  config = withGradleProperties(config, (next) => {
    next.modResults = next.modResults.filter((item) => item.type !== 'property' || item.key !== 'android.kotlinVersion');
    next.modResults.push({ type: 'property', key: 'android.kotlinVersion', value: KOTLIN_VERSION });
    return next;
  });
  return withProjectBuildGradle(config, (next) => {
    if (next.modResults.language !== 'groovy') {
      throw new Error('LiteRT Kotlin configuration requires a Groovy root build.gradle.');
    }
    // Match Expo's root buildscript dependencies, allowing its repositories block.
    // Fail closed if the template changes instead of editing a different scope.
    const dependencies = /(^[\t ]*buildscript\s*\{(?:[^{}]|\{[^{}]*\})*?\bdependencies\s*\{)([^{}]*)(\})/m;
    if (!dependencies.test(next.modResults.contents)) {
      throw new Error('Cannot locate Expo root buildscript dependencies for LiteRT Kotlin configuration.');
    }
    next.modResults.contents = next.modResults.contents.replace(dependencies, (block, start, body, end) => {
      const classpath = /(^[\t ]*classpath\s*(?:\(\s*)?['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin)(?::[^'"\r\n]+)?(['"])/gm;
      if (classpath.test(body)) {
        return start + body.replace(classpath, `$1:${KOTLIN_VERSION}$2`) + end;
      }
      const newline = block.includes('\r\n') ? '\r\n' : '\n';
      const indent = body.match(/\n([\t ]*)\S/)?.[1] ?? '    ';
      return `${start}${newline}${indent}classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}')${body}${end}`;
    });
    return next;
  });
};
