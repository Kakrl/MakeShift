// Digital Web Audio verification; no server or physical audio device required.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require=createRequire(new URL("../../frontend/package.json",import.meta.url));
const {chromium}=require("playwright");
const ts=require("typescript");
const compile=source => ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const dataUrl=source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const meter=dataUrl(compile(await readFile(new URL("../../frontend/src/lib/meter.ts",import.meta.url),"utf8")));
const source=compile(await readFile(new URL("../../frontend/src/app/audio/countIn.ts",import.meta.url),"utf8"));
const moduleUrl=dataUrl(source.replace('"../../lib/meter"',JSON.stringify(meter)));
const browser=await chromium.launch({channel:process.env.AUDIO_BROWSER_CHANNEL ?? "chromium",headless:true});
try {
  const page=await browser.newPage();
  const results=await page.evaluate(async moduleUrl => {
    const {scheduleCountInClicks}=await import(moduleUrl);
    const rows=[];
    for(const [numerator,denominator] of [[4,4],[3,4],[6,8],[7,8],[2,2]]) {
      const rate=48000, spacing=rate*0.5*4/denominator;
      const context=new OfflineAudioContext(1,numerator*spacing,rate);
      scheduleCountInClicks(context,120,{numerator,denominator});
      const pcm=(await context.startRendering()).getChannelData(0);
      const onsets=[];
      for(let beat=0;beat<numerator;beat++) {
        const boundary=beat*spacing;
        let onset=boundary;
        while(onset<boundary+32 && Math.abs(pcm[onset])<0.0001) onset++;
        if(onset>=boundary+32) throw new Error("Missing click at expected audio deadline");
        onsets.push(onset);
        for(let sample=boundary+Math.floor(spacing*0.8);sample<boundary+spacing;sample++)
          if(pcm[sample]!==0) throw new Error("Unexpected late click/tail");
      }
      const canceled=new OfflineAudioContext(1,numerator*spacing,rate);
      const cancel=scheduleCountInClicks(canceled,120,{numerator,denominator});
      cancel();
      if((await canceled.startRendering()).getChannelData(0).some(sample => sample!==0)) throw new Error("Canceled clicks still rendered");
      rows.push({numerator,denominator,spacing,onsets});
    }
    return {browser:navigator.userAgent,rows};
  },moduleUrl);
  for(const row of results.rows) {
    for(let beat=1;beat<row.onsets.length;beat++)
      assert.equal(row.onsets[beat]-row.onsets[beat-1],row.spacing);
  }
  console.log(JSON.stringify({result:"PASS: sample-exact equal click spacing and silent cancellation",...results},null,2));
} finally {await browser.close();}
