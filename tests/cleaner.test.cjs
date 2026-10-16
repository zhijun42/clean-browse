const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');

let context;
let profile;
const pageErrors = [];

function fixture(url) {
  const query = (url.searchParams.get('q') || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const searchClass = url.hostname.endsWith('bilibili.com') ? 'nav-search-content' : 'SearchBar';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cleaner test</title></head><body>
    <header><form class="${searchClass}" action="/search">
      <input type="text" name="q" placeholder="今日推荐热搜" value="${query}">
      <button type="submit">搜索</button>
    </form></header>
    <input id="unrelated-input" placeholder="选择语言">
    <article id="article">WebSocket 技术正文，提到了 MathWorks 广告设计。
      <img id="article-image" alt="普通配图">
    </article>
    <aside>
      <div class="Card AuthorCard">作者资料与关注按钮</div>
      <div data-smart-sticky-anchor="true">
        <div class="HotSearchCard"><div class="HotSearchCard-title">大家都在搜</div><a>热点新闻</a></div>
        <div id="mathworks-ad" class="Pc-card Card"><a class="Banner-link" href="https://www.mathworks.cn/"><div class="Banner-image">MathWorks 广告</div></a></div>
      </div>
      <div id="normal-card" class="Pc-card Card">正常侧栏内容</div>
    </aside>
    <div class="pc-article-answer-big-img"><a href="https://example.com/ad"><div class="pc-article-answer-big-img-card">其他品牌的图片广告</div></a></div>
    <div id="live-title" class="floor-single-card"><span class="floor-title">直播</span></div>
    <div id="live-link" class="floor-single-card"><a href="https://live.bilibili.com/123">直播间</a></div>
    <div id="normal-video" class="floor-single-card"><span class="floor-title">直播技术讲解视频</span><a href="https://www.bilibili.com/video/BVtest">普通视频</a></div>
    <div id="query-video" class="floor-single-card"><a href="https://www.bilibili.com/video/BVother?from=https://live.bilibili.com/">普通链接</a></div>
  </body></html>`;
}

before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-browsing-test-'));
  const extensionPath = path.resolve(__dirname, '..');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route('https://**/*', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: fixture(new URL(route.request().url())),
  }));
  context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));
});

after(async () => {
  if (context) await context.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'Content scripts must not cause page errors');
});

async function open(url) {
  const page = await context.newPage();
  await page.goto(url);
  if (new URL(url).hostname !== 'example.com') {
    await page.waitForFunction(() => document.querySelector('header input')?.placeholder === '');
  }
  return page;
}

test('Zhihu and its article subdomain clear recommendations while preserving inputs and article content', async () => {
  for (const host of ['www.zhihu.com', 'zhuanlan.zhihu.com', 'zhihu.com']) {
    const page = await open(`https://${host}/p/example?q=WebSocket`);
    assert.equal(await page.locator('header input').inputValue(), 'WebSocket');
    assert.equal(await page.locator('header input').getAttribute('aria-label'), '搜索');
    assert.equal(await page.locator('#unrelated-input').getAttribute('placeholder'), '选择语言');
    assert.equal(await page.locator('#article').isVisible(), true);
    assert.equal(await page.locator('#article-image').isVisible(), true);
    assert.equal(await page.locator('.AuthorCard').isVisible(), true);
    await page.close();
  }
});

test('Zhihu hides complete hot-search and ad cards without hiding ordinary sidebar cards', async () => {
  const page = await open('https://zhuanlan.zhihu.com/p/example');
  for (const selector of ['.HotSearchCard', '#mathworks-ad', '.pc-article-answer-big-img']) {
    assert.equal(await page.locator(selector).isVisible(), false, selector);
    assert.equal(await page.locator(selector).evaluate((element) => element.getBoundingClientRect().height), 0, selector);
  }
  assert.equal(await page.locator('#normal-card').isVisible(), true);
  assert.equal(await page.locator('#normal-video').isVisible(), true);
  await page.close();
});

test('new ads and hot-search containers are hidden after dynamic rendering', async () => {
  const page = await open('https://www.zhihu.com/');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div id="new-ad" class="Pc-card Card" style="display:block"><a class="Banner-link">另一个广告品牌</a></div><div id="new-hot">稍后加载的热搜</div>');
    document.querySelector('#new-hot').className = 'HotSearchCard';
  });
  assert.equal(await page.locator('#new-ad').isVisible(), false);
  assert.equal(await page.locator('#new-hot').isVisible(), false);
  await page.close();
});

test('site rewrites and replacement search inputs are cleaned without changing user text or existing labels', async () => {
  const page = await open('https://www.zhihu.com/');
  await page.locator('header input').fill('我自己的关键词');
  await page.evaluate(() => {
    document.querySelector('header input').placeholder = '重新写入的推荐';
    document.body.insertAdjacentHTML('beforeend', '<div class="SearchBar"><input id="second-search" placeholder="动态热搜" value="另一个关键词" aria-label="站内搜索"></div>');
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.SearchBar input')].every((input) => input.placeholder === ''));
  assert.equal(await page.locator('header input').inputValue(), '我自己的关键词');
  assert.equal(await page.locator('#second-search').inputValue(), '另一个关键词');
  assert.equal(await page.locator('#second-search').getAttribute('aria-label'), '站内搜索');
  await page.close();
});

test('empty-input hot suggestions disappear while search history and typed suggestions remain visible', async () => {
  const page = await open('https://www.zhihu.com/');
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', `
    <div id="mixed-menu" class="SearchBar-menuContainer"><div class="SearchBar-noValueMenu">
      <div id="history" class="AutoComplete-group">我的搜索历史</div>
      <div id="hot-group" class="AutoComplete-group"><div class="SearchBar-label">搜索发现</div><div class="SearchBar-topSearchItem">热点词</div></div>
    </div></div>
    <div id="hot-only-menu" class="SearchBar-menuContainer"><div class="SearchBar-noValueMenu"><div class="AutoComplete-group"><div class="SearchBar-topSearchItem">热点词</div></div></div></div>
    <div id="typed-menu" class="SearchBar-menuContainer"><div class="SearchBar-menu"><div class="AutoComplete-group">WebSocket 教程</div></div></div>
  `));
  assert.equal(await page.locator('#hot-group').isVisible(), false);
  assert.equal(await page.locator('#hot-only-menu').isVisible(), false);
  assert.equal(await page.locator('#mixed-menu').isVisible(), true);
  assert.equal(await page.locator('#history').isVisible(), true);
  assert.equal(await page.locator('#typed-menu').isVisible(), true);
  await page.close();
});

test('the real search input and submit button still submit the exact user-entered query', async () => {
  const page = await open('https://www.zhihu.com/');
  const query = 'WebSocket 协议 & Java';
  await page.locator('header input').fill(query);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/search' && url.searchParams.get('q') === query),
    page.locator('header button').click(),
  ]);
  assert.equal(new URL(page.url()).searchParams.get('q'), query);
  assert.equal(await page.locator('header input').inputValue(), query);
  await page.close();
});

test('Bilibili retains both cleanup features and does not mistake video links for live rooms', async () => {
  const page = await open('https://www.bilibili.com/?q=技术视频');
  await page.waitForFunction(() => document.querySelector('#live-link')?.hasAttribute('data-quiet-browsing-live'));
  assert.equal(await page.locator('header input').inputValue(), '技术视频');
  assert.equal(await page.locator('#live-title').isVisible(), false);
  assert.equal(await page.locator('#live-link').isVisible(), false);
  assert.equal(await page.locator('#normal-video').isVisible(), true);
  assert.equal(await page.locator('#query-video').isVisible(), true);
  assert.equal(await page.locator('.HotSearchCard').isVisible(), true);
  await page.close();
});

test('Bilibili dynamic cards and reused card links are classified again', async () => {
  const page = await open('https://www.bilibili.com/');
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div id="dynamic-live" class="floor-single-card"><a href="https://live.bilibili.com/456">新直播间</a></div>'));
  await page.waitForFunction(() => document.querySelector('#dynamic-live')?.hasAttribute('data-quiet-browsing-live'));
  assert.equal(await page.locator('#dynamic-live').isVisible(), false);
  await page.locator('#dynamic-live a').evaluate((link) => { link.href = 'https://www.bilibili.com/video/BVnew'; });
  await page.waitForFunction(() => !document.querySelector('#dynamic-live')?.hasAttribute('data-quiet-browsing-live'));
  assert.equal(await page.locator('#dynamic-live').isVisible(), true);
  await page.close();
});

test('unrelated sites do not receive the extension rules', async () => {
  const page = await open('https://example.com/');
  assert.equal(await page.locator('header input').getAttribute('placeholder'), '今日推荐热搜');
  assert.equal(await page.locator('.HotSearchCard').isVisible(), true);
  assert.equal(await page.locator('#mathworks-ad').isVisible(), true);
  await page.close();
});
