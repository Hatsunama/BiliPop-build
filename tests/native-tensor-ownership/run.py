#!/usr/bin/env python3
"""Offline JVM ownership tests using cached Kotlin compiler and explicit ONNX doubles."""
import argparse, hashlib, os, pathlib, subprocess, tempfile
p = argparse.ArgumentParser()
p.add_argument('--cache', required=True, type=pathlib.Path, help='Gradle modules-2/files-2.1 cache, used read-only')
p.add_argument('--java', default='java')
p.add_argument('--source', type=pathlib.Path)
a = p.parse_args()
here = pathlib.Path(__file__).resolve().parent
source = a.source or here / 'legacy-BiliPopTranslationModule.kt'
original = source.read_text()
# Exclude Expo registration only; decode, helpers, fields and data classes stay verbatim.
start = original.index('  override fun definition()')
end = original.index('  private data class Beam(', start)
extracted = original[:start] + original[end:]
extracted = '\n'.join(line for line in extracted.splitlines() if not line.startswith('import expo.'))
extracted = extracted.replace('class BiliPopTranslationModule : Module() {', 'class BiliPopTranslationModule {')
def jar(group, artifact, version):
    paths = list((a.cache / group / artifact / version).glob('*/*.jar'))
    if len(paths) != 1: raise RuntimeError(f'Missing or ambiguous cached jar: {artifact} {version}')
    return str(paths[0])
stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '1.9.24')
annotations = jar('org.jetbrains', 'annotations', '13.0')
compiler = [jar('org.jetbrains.kotlin', artifact, '1.9.24') for artifact in ['kotlin-compiler-embeddable', 'kotlin-script-runtime', 'kotlin-daemon-embeddable']]
compiler += [stdlib, annotations, jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330')]
print('Production source SHA-256:', hashlib.sha256(original.encode()).hexdigest(), flush=True)
with tempfile.TemporaryDirectory(prefix='bilipop-ownership-') as folder:
    folder = pathlib.Path(folder)
    unit = folder / source.name; unit.write_text(extracted)
    out = folder / 'classes'
    subprocess.run([a.java, '-Xmx384m', '-XX:ActiveProcessorCount=2', '-cp', os.pathsep.join(compiler), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-nowarn', '-classpath', os.pathsep.join([stdlib, annotations]), '-d', str(out), str(unit), str(here / 'OnnxDoubles.kt'), str(here / 'OwnershipTest.kt')], check=True, timeout=90)
    subprocess.run([a.java, '-Xmx128m', '-XX:ActiveProcessorCount=2', '-cp', os.pathsep.join([str(out), stdlib]), 'OwnershipTestKt'], check=True, timeout=30)
