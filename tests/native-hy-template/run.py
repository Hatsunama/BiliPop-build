#!/usr/bin/env python3
"""Compile real production adapter/controller with explicit SDK contract doubles."""
import argparse,pathlib,subprocess,tempfile,os
p=argparse.ArgumentParser();p.add_argument('--cache',required=True,type=pathlib.Path);a=p.parse_args()
here=pathlib.Path(__file__).resolve().parent;root=here.parents[1]
jars=list(a.cache.rglob('*.jar'))
cp=os.pathsep.join(map(str,jars));sources=root/'modules/my-module/android/src/main/java/app/bilipop/translation'
with tempfile.TemporaryDirectory(prefix='bilipop-first-turn-') as tmp:
 out=str(pathlib.Path(tmp)/'test.jar')
 subprocess.run(['java','-Xmx512m','-cp',cp,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-jvm-target','17','-classpath',cp,'-d',out,str(sources/'LiteRtTranslationEngine.kt'),str(sources/'SerialTranslationRuntime.kt'),str(here/'LiteRtDoubles.kt'),str(here/'FirstTurnTests.kt')],check=True)
 subprocess.run(['java','-cp',out+os.pathsep+cp,'app.bilipop.translation.FirstTurnTestsKt'],check=True)
