// Record real browser interactions against an isolated demo workspace.
// Requires Playwright; BASE_URL defaults to http://127.0.0.1:8767.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const out = path.resolve(process.env.RECORDING_DIR || '/tmp/paperbridge-video');
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({viewport:{width:1600,height:1000},
    recordVideo:{dir:out,size:{width:1600,height:1000}}});
  await context.addInitScript(() => {
    localStorage.setItem('helped','1'); localStorage.setItem('panelW','360px');
    localStorage.setItem('paperbridge.appearance',JSON.stringify({size:18,font:'serif',theme:'paper'}));
    // Visible cursor follows actual mouse events; no app content is simulated.
    addEventListener('DOMContentLoaded',()=>{
      const cursor=document.createElement('div');
      cursor.style.cssText='position:fixed;left:-40px;top:-40px;width:17px;height:17px;border:2px solid #2563eb;background:#3b82f633;border-radius:50%;pointer-events:none;z-index:99999;transform:translate(-50%,-50%)';
      document.body.append(cursor);
      addEventListener('mousemove',e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
      addEventListener('mousedown',()=>cursor.style.background='#2563eb99');
      addEventListener('mouseup',()=>cursor.style.background='#3b82f633');
    });
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const pause=ms=>page.waitForTimeout(ms);
  async function click(selector) {
    const element=page.locator(selector);const box=await element.boundingBox();
    if(!box) throw Error('Element not visible: '+selector);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:20});
    await pause(180);await page.mouse.down();await pause(110);await page.mouse.up();
  }
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:8767')+'/#4');
  await page.waitForSelector('.unit .zh');
  await page.waitForFunction(()=>document.querySelector('.unit img')?.naturalWidth>0);
  await pause(1600);
  await click('#lang-seg [data-lang="en"]');await pause(1100);
  await click('#lang-seg [data-lang="side"]');await pause(1000);
  await click('#toc [data-key="4"]');
  await page.waitForFunction(()=>document.querySelector('.unit img')?.naturalWidth>0);
  await pause(2000);
  await page.screenshot({path:path.join(out,'01-original-figure.png')});
  // Select the opening sentence with the actual pointer, then annotate selection.
  const paragraph=page.locator('.unit[data-id="overview"] .en');const box=await paragraph.boundingBox();
  await page.mouse.move(box.x+3,box.y+15);await page.mouse.down();
  await page.mouse.move(box.x+Math.min(box.width-10,340),box.y+15,{steps:30});
  await page.mouse.up();await pause(700);
  await click('#sel-pop [data-act="note"]');await pause(500);
  await click('#note-input');
  for(const text of ['阅读笔记：','PA 先对齐，','DDI 再分离共享与特有语义；','结合图 2 核对模块顺序。']) {
    await page.keyboard.insertText(text);await pause(420);
  }
  await pause(650);await click('#note-save');await page.waitForSelector('#notes-list .note');
  if(await page.locator('#sel-pop').isVisible())throw Error('Selection menu stayed visible after annotation');
  await pause(1500);
  await page.screenshot({path:path.join(out,'02-annotation.png')});
  await click('#sec-reviewed');await pause(800);
  await click('.appearance summary');await pause(600);
  await click('#reading-size');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await pause(700);
  await click('#reading-font');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await pause(800);
  await click('#reading-theme');await page.keyboard.press('End');await page.keyboard.press('Enter');await pause(1400);
  await page.screenshot({path:path.join(out,'03-dark-theme.png')});
  await click('.appearance summary');await pause(1700);
  await page.mouse.move(900,760);await page.mouse.wheel(0,410);await pause(1500);
  await click('.appearance summary');await click('#appearance-reset');await click('.appearance summary');
  await page.mouse.wheel(0,-900);await pause(1700);
  const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
  if(!state.notes.some(n=>n.quote && n.text.includes('结合图 2')))throw Error('Selected-text annotation was not saved');
  if(errors.length)throw Error(errors.join('\n'));
  await context.close();
  const video=await page.video().path();await fs.writeFile(path.join(out,'video-path.txt'),video);
  await browser.close();console.log(video);
})().catch(error=>{console.error(error);process.exit(1)});
