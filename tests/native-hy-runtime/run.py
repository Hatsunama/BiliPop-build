#!/usr/bin/env python3
"""Small JVM runtime/download tests; no Android/emulator or model download.
Compile against the actual pinned LiteRT AAR separately via --litert-classes.
Uses only the supplied cached compiler; outputs live in a temporary directory.
"""
import argparse,pathlib,subprocess,tempfile,os
p=argparse.ArgumentParser();p.add_argument('--cache',required=True,type=pathlib.Path);p.add_argument('--java',default='java');p.add_argument('--litert-classes',type=pathlib.Path);p.add_argument('--compiler-cache',type=pathlib.Path);p.add_argument('--compiler-version',default='2.1.20');p.add_argument('--bridge-classpath');a=p.parse_args()
here=pathlib.Path(__file__).resolve().parent;root=here.parents[1]
def jar(group, artifact,version=None):
 paths=[]
 for cache in [a.compiler_cache,a.cache]:
  if cache: paths=sorted((cache/group/artifact).glob((version or '*')+'/*/*.jar'))
  if paths: break
 if not paths:raise SystemExit(f'Missing cached {group}:{artifact}:{version or "*"}')
 return str(paths[-1])
stdlib=jar('org.jetbrains.kotlin','kotlin-stdlib',a.compiler_version)
compiler=[jar('org.jetbrains.kotlin','kotlin-compiler-embeddable',a.compiler_version),stdlib,jar('org.jetbrains.kotlin','kotlin-script-runtime',a.compiler_version),jar('org.jetbrains.kotlin','kotlin-reflect',a.compiler_version),jar('org.jetbrains.intellij.deps','trove4j'),jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm'),jar('org.jetbrains','annotations')]
if a.compiler_version == '2.4.0': compiler += [jar('org.jetbrains.kotlin','kotlin-build-tools-api','2.4.0'),jar('org.jetbrains.kotlin','kotlin-daemon-embeddable','2.4.0')]
sources=root/'modules/my-module/android/src/main/java/app/bilipop/translation'
with tempfile.TemporaryDirectory(prefix='bilipop-hy-jvm-') as tmp:
 out=str(pathlib.Path(tmp)/'tests.jar')
 cp=[stdlib,jar('org.jetbrains','annotations'),jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm')]
 files=[str(sources/name) for name in ['SerialTranslationRuntime.kt','PinnedModelStore.kt','ModelPreparation.kt','TranslationWorkQueues.kt']]+[str(here/'RuntimeTests.kt'),str(here/'BridgeQueueTests.kt')]
 if a.litert_classes:
  cp += [str(a.litert_classes),jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm')]
  files += [str(sources/'LiteRtTranslationEngine.kt')]
 if a.bridge_classpath:
  cp += a.bridge_classpath.split(os.pathsep)
  files += [str(sources/'BiliPopTranslationModule.kt')]
 cmd=[a.java,'-Xmx512m','-cp',os.pathsep.join(compiler),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-jvm-target','17','-classpath',os.pathsep.join(cp),'-d',out,*files]
 subprocess.run(cmd,check=True)
 subprocess.run([a.java,'-cp',os.pathsep.join([out,*cp]),'app.bilipop.translation.RuntimeTestsKt',str(sources/'BiliPopTranslationModule.kt')],check=True)
 print('PASS Kotlin compile'+(' against real LiteRT-LM 0.17.1 classes' if a.litert_classes else '')+'; JNI inference NOT run')
