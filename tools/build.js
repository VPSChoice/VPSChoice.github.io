#!/usr/bin/env node
/**
 * VPSChoice 站点构建脚本
 *
 *   node tools/build.js
 *
 * 输入：
 *   data/site.json        站点配置、导航、页面元数据
 *   data/providers.json   商家资料与套餐价格（唯一真相源）
 *   templates/layout.html 页面骨架
 *   content/<slug>.html   各页正文
 *
 * 输出：
 *   <out>/index.html      成品页面（含导航、侧边栏、面包屑、相关文章、JSON-LD）
 *   sitemap.xml           自动生成
 *
 * 正文里可用的占位符：
 *   {{plans:<商家id>}}      渲染该商家的套餐价格表
 *   {{providers:<分类>}}    渲染该分类的商家对比表
 *   {{link:<商家id>}}       该商家的推广链接（href 用）
 *   {{a:<商家id>}}          一个完整的推广链接 <a> 标签
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = function (p) { return path.join(ROOT, p); };
const read = function (p) { return fs.readFileSync(R(p), 'utf8'); };
const json = function (p) { return JSON.parse(read(p)); };

const site = json('data/site.json');
const db = json('data/providers.json');
const layout = read('templates/layout.html');

const S = site.site;
const BASE = S.url.replace(/\/$/, '');
const byId = {};
db.providers.forEach(function (p) { byId[p.id] = p; });

const esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
const REL = 'target="_blank" rel="noreferrer noopener nofollow sponsored"';

const pages = site.pages.filter(function (p) { return !p.draft; });
const bySlug = {};
site.pages.forEach(function (p) { bySlug[p.slug] = p; });

/* ---------------- 片段渲染 ---------------- */

// 相对根路径前缀：/guide/setup-proxy/ → ../../
function rootPrefix(url) {
  const depth = url.replace(/^\/|\/$/g, '').split('/').filter(Boolean).length;
  return depth ? '../'.repeat(depth) : './';
}

function renderNav(current) {
  const items = pages.filter(function (p) { return p.nav; }).map(function (p) {
    const on = p.slug === current.slug;
    return '<a href="' + rootPrefix(current.url) + p.url.replace(/^\//, '') + '"' +
      (on ? ' class="is-current" aria-current="page"' : '') + '>' + esc(p.nav) + '</a>';
  });
  return items.join('\n                ');
}

function renderBreadcrumb(page) {
  if (!page.breadcrumb || !page.breadcrumb.length) return '';
  const root = rootPrefix(page.url);
  const parts = ['<a href="' + root + '">首页</a>'];
  page.breadcrumb.forEach(function (b, i) {
    const last = i === page.breadcrumb.length - 1;
    if (b.url && !last) parts.push('<a href="' + root + b.url.replace(/^\//, '') + '">' + esc(b.name) + '</a>');
    else parts.push('<span aria-current="page">' + esc(b.name) + '</span>');
  });
  return '<nav class="breadcrumb" aria-label="面包屑">' + parts.join('<i>›</i>') + '</nav>\n';
}

// 从正文里的 h2/h3 自动生成目录
function renderToc(html) {
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  const items = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({ level: +m[1], id: m[2], text: m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() });
  }
  if (items.length < 3) return '';
  const lis = items.map(function (i) {
    return '<li class="lv' + i.level + '"><a href="#' + i.id + '">' + esc(i.text) + '</a></li>';
  }).join('\n                ');
  // details 元素：桌面端隐藏 summary 常开，移动端可折叠
  return '<details class="side-box toc-box" id="toc" open>\n' +
    '            <summary class="side-title">文章目录</summary>\n' +
    '            <ol class="toc-list">\n                ' + lis + '\n            </ol>\n        </details>';
}

// 侧边栏商家推荐：全站统一展示 sidebarOrder 指定的商家
function renderProviderBox() {
  const list = (db.sidebarOrder || []).map(function (id) { return byId[id]; }).filter(Boolean);
  if (!list.length) return '';
  const items = list.map(function (p) {
    return '<li>\n                    <a href="' + esc(p.url) + '" ' + REL + '>' + esc(p.name) + '</a>' +
      (p.priceFrom ? '<span class="pv-price">' + esc(p.priceFrom) + '</span>' : '') +
      (p.tagline ? '\n                    <span class="pv-tag">' + esc(p.tagline) + '</span>' : '') +
      '\n                </li>';
  }).join('\n                ');

  return '<div class="side-box provider-box">\n' +
    '            <h2 class="side-title">商家推荐</h2>\n' +
    '            <ul class="pv-list">\n                ' + items + '\n            </ul>\n' +
    '            <p class="pv-note">价格说明：表中为整理时的参考价，商家促销与调价频繁，实际价格以官网结算页为准。</p>\n        </div>';
}

// {{homeGroups}} → 首页按消费群体分组的商家推荐
function renderHomeGroups() {
  if (!db.homeGroups) return '';
  return db.homeGroups.map(function (g) {
    const cards = g.items.map(function (it) {
      const p = byId[it.id];
      if (!p) { console.error('  ! 分组引用了未知商家: ' + it.id); return ''; }
      return '<div class="pick">\n' +
        '                    <p class="pick-name"><a href="' + esc(p.url) + '" ' + REL + '>' + esc(p.name) + '</a>' +
        (p.priceFrom ? '<span class="pick-price">' + esc(p.priceFrom) + '</span>' : '') + '</p>\n' +
        '                    <p class="pick-why">' + esc(it.why) + '</p>\n' +
        '                </div>';
    }).filter(Boolean).join('\n                ');
    return '<div class="home-group">\n' +
      '                <h3 id="group-' + g.id + '">' + esc(g.name) + '</h3>\n' +
      '                <p class="group-intro">' + esc(g.intro) + '</p>\n' +
      '                <div class="pick-grid">\n                ' + cards + '\n                </div>\n            </div>';
  }).join('\n            ');
}

function renderRelated(page) {
  if (!page.related || !page.related.length) return '';
  const root = rootPrefix(page.url);
  const items = page.related.map(function (slug) {
    const t = bySlug[slug];
    if (!t || t.draft || t.slug === page.slug) return null;
    return '<li><a href="' + root + t.url.replace(/^\//, '') + '"><strong>' + esc(t.nav || t.h1) + '</strong>' +
      '<span>' + esc(t.subtitle || '') + '</span></a></li>';
  }).filter(Boolean);
  if (!items.length) return '';
  return '\n<section class="related">\n    <h2>相关阅读</h2>\n    <ul>\n        ' +
    items.join('\n        ') + '\n    </ul>\n</section>\n';
}

// {{plans:id}} → 套餐价格表
function renderPlans(id) {
  const p = byId[id];
  if (!p) { console.error('  ! 未知商家 id: ' + id); return ''; }
  if (!p.tables || !p.tables.length) return '';
  return p.tables.map(function (t) {
    const head = t.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
    const body = t.rows.map(function (r) {
      const tds = r.map(function (c) {
        if (typeof c === 'string') return '<td>' + c + '</td>';
        if (c.link) {
          return '<td class="' + esc(c.cls) + '"><a href="' + esc(c.link) + '" ' + REL + '>' + esc(c.text) + '</a></td>';
        }
        return '<td' + (c.cls ? ' class="' + esc(c.cls) + '"' : '') + '>' + c.text + '</td>';
      }).join('');
      return '<tr>' + tds + '</tr>';
    }).join('\n                                    ');
    return (t.label ? '<b>' + esc(t.label) + '</b>\n                            ' : '') +
      '<table class="provider-table">\n' +
      '                                <thead><tr>' + head + '</tr></thead>\n' +
      '                                <tbody>\n                                    ' + body +
      '\n                                </tbody>\n                            </table>';
  }).join('\n                            ');
}

// {{providers:分类}} → 该分类的商家对比表
function renderProviderTable(cat) {
  const list = db.providers.filter(function (p) { return p.categories.indexOf(cat) >= 0; });
  if (!list.length) return '';
  const rows = list.map(function (p) {
    return '<tr><td><strong><a href="' + esc(p.url) + '" ' + REL + '>' + esc(p.name) + '</a></strong></td>' +
      '<td>' + esc(p.tagline || '') + '</td>' +
      '<td>' + (p.priceFrom ? '<span class="price-tag">' + esc(p.priceFrom) + '</span>' : '—') + '</td>' +
      '<td>' + (p.strengths || []).map(function (s) { return '<span class="tag">' + esc(s) + '</span>'; }).join(' ') + '</td></tr>';
  }).join('\n                        ');
  return '<div class="vps-table">\n                    <table>\n' +
    '                        <thead><tr><th>商家</th><th>特点</th><th>起步价</th><th>优势</th></tr></thead>\n' +
    '                        <tbody>\n                        ' + rows + '\n                        </tbody>\n' +
    '                    </table>\n                </div>';
}

/* ---------------- 结构化数据 ---------------- */

function buildJsonLd(page, contentHtml) {
  const url = BASE + page.url;
  const today = new Date().toISOString().slice(0, 10);
  const graph = [
    {
      '@type': 'WebSite', '@id': BASE + '/#website', url: BASE + '/',
      name: S.name, inLanguage: S.lang, description: S.tagline
    },
    {
      '@type': 'Article', '@id': url + '#article',
      isPartOf: { '@id': BASE + '/#website' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      headline: page.h1, description: page.description, inLanguage: S.lang,
      image: BASE + '/' + S.ogImage,
      author: { '@type': 'Organization', name: S.name, url: BASE + '/' },
      publisher: { '@type': 'Organization', name: S.name, url: BASE + '/' },
      dateModified: today
    }
  ];

  const crumbs = [{ '@type': 'ListItem', position: 1, name: '首页', item: BASE + '/' }];
  (page.breadcrumb || []).forEach(function (b, i) {
    const it = { '@type': 'ListItem', position: i + 2, name: b.name };
    if (b.url) it.item = BASE + b.url;
    crumbs.push(it);
  });
  if (crumbs.length > 1 || page.slug === 'index') {
    graph.push({ '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: crumbs });
  }

  // 当前页分类的商家清单
  const list = db.providers.filter(function (p) { return p.categories.indexOf(page.category) >= 0; });
  if (list.length) {
    graph.push({
      '@type': 'ItemList', '@id': url + '#providers',
      name: (db.categories[page.category] || {}).name + ' VPS 商家推荐',
      numberOfItems: list.length,
      itemListElement: list.map(function (p, i) {
        return { '@type': 'ListItem', position: i + 1, name: p.fullName || p.name, description: p.tagline || undefined };
      })
    });
  }

  // FAQ
  const decode = function (s) {
    return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  };
  const toText = function (f) {
    return decode(f.replace(/<li[^>]*>/gi, '\n· ').replace(/<\/(p|div|li|ul|ol|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+/g, ' ').split('\n').map(function (l) { return l.trim(); })
      .filter(Boolean).join(' ').trim();
  };
  const faqRe = /<div class="faq-item">\s*<div class="faq-question">([\s\S]*?)<\/div>\s*(?:<!--[\s\S]*?-->\s*)*<div class="faq-answer">([\s\S]*?)<\/div>\s*<\/div>/g;
  const faqs = [];
  const seen = {};
  let m;
  while ((m = faqRe.exec(contentHtml)) !== null) {
    const q = toText(m[1]), a = toText(m[2]);
    if (!q || !a || seen[q]) continue;
    seen[q] = 1;
    faqs.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  }
  if (faqs.length) {
    graph.push({ '@type': 'FAQPage', '@id': url + '#faq', isPartOf: { '@id': BASE + '/#website' }, mainEntity: faqs });
  }

  return {
    html: '<script type="application/ld+json">\n' +
      JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2) + '\n</script>',
    faqCount: faqs.length
  };
}

/* ---------------- 构建 ---------------- */

let built = 0;
const summary = [];

pages.forEach(function (page) {
  const src = 'content/' + page.slug + '.html';
  if (!fs.existsSync(R(src))) {
    console.error('  ! 缺少正文文件：' + src + '（跳过 ' + page.slug + '）');
    return;
  }
  let content = read(src);
  const root = rootPrefix(page.url);

  // 正文占位符
  content = content.replace(/\{\{plans:([a-z0-9-]+)\}\}/g, function (_, id) { return renderPlans(id); });
  content = content.replace(/\{\{providers:([a-z-]+)\}\}/g, function (_, c) { return renderProviderTable(c); });
  content = content.replace(/\{\{homeGroups\}\}/g, function () { return renderHomeGroups(); });
  content = content.replace(/\{\{link:([a-z0-9-]+)\}\}/g, function (_, id) { return byId[id] ? esc(byId[id].url) : '#'; });
  content = content.replace(/\{\{a:([a-z0-9-]+)\}\}/g, function (_, id) {
    const p = byId[id];
    return p ? '<a href="' + esc(p.url) + '" ' + REL + '>' + esc(p.name) + '</a>' : id;
  });
  // 子目录页面的相对资源路径
  if (root !== './') content = content.split('./static/').join(root + 'static/');

  const ld = buildJsonLd(page, content);

  const html = layout
    .replace(/\{\{lang\}\}/g, S.lang)
    .replace(/\{\{siteName\}\}/g, esc(S.name))
    .replace(/\{\{tagline\}\}/g, esc(S.tagline))
    .replace(/\{\{themeColor\}\}/g, S.themeColor)
    .replace(/\{\{title\}\}/g, esc(page.title))
    .replace(/\{\{description\}\}/g, esc(page.description))
    .replace(/\{\{keywords\}\}/g, esc(page.keywords || ''))
    .replace(/\{\{canonical\}\}/g, BASE + page.url)
    .replace(/\{\{ogImage\}\}/g, BASE + '/' + S.ogImage)
    .replace(/\{\{root\}\}/g, root)
    .replace(/\{\{h1\}\}/g, esc(page.h1))
    .replace(/\{\{subtitle\}\}/g, esc(page.subtitle || ''))
    .replace(/\{\{nav\}\}/g, renderNav(page))
    .replace(/\{\{breadcrumb\}\}/g, renderBreadcrumb(page))
    .replace(/\{\{toc\}\}/g, renderToc(content))
    .replace(/\{\{providerBox\}\}/g, renderProviderBox())
    .replace(/\{\{related\}\}/g, renderRelated(page))
    .replace(/\{\{footer\}\}/g, S.footer.map(function (l) { return '<p>' + l + '</p>'; }).join('\n            '))
    .replace(/\{\{jsonld\}\}/g, ld.html)
    .replace(/\{\{content\}\}/g, function () { return content; });

  const outPath = R(page.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  built++;
  summary.push('  ' + page.out.padEnd(34) + (html.length / 1024).toFixed(0).padStart(4) + ' KB   FAQ ' + ld.faqCount);
});

/* ---------------- sitemap ---------------- */

const today = new Date().toISOString().slice(0, 10);
const urls = pages.map(function (p) {
  const imgs = p.slug === 'index'
    ? db.providers.filter(function (x) { return x.logo; }).map(function (x) {
      return '        <image:image>\n            <image:loc>' + BASE + '/' + x.logo.replace(/^\.\//, '') +
        '</image:loc>\n            <image:title>' + esc(x.logoAlt || x.name) + '</image:title>\n        </image:image>';
    }).join('\n') : '';
  return '    <url>\n        <loc>' + BASE + p.url + '</loc>\n' +
    '        <lastmod>' + today + '</lastmod>\n' +
    '        <changefreq>weekly</changefreq>\n' +
    '        <priority>' + (p.slug === 'index' ? '1.0' : '0.8') + '</priority>\n' +
    (imgs ? imgs + '\n' : '') + '    </url>';
}).join('\n');

fs.writeFileSync(R('sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
  '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + urls + '\n</urlset>\n');

fs.writeFileSync(R('robots.txt'),
  'User-agent: *\nAllow: /\n\n# 主要搜索引擎\nUser-agent: Googlebot\nAllow: /\n\n' +
  'User-agent: Bingbot\nAllow: /\n\nUser-agent: Baiduspider\nAllow: /\n\n' +
  'Sitemap: ' + BASE + '/sitemap.xml\n');

console.log('构建完成：' + built + ' 个页面');
summary.forEach(function (l) { console.log(l); });
const drafts = site.pages.filter(function (p) { return p.draft; });
if (drafts.length) {
  console.log('草稿（未构建）：' + drafts.map(function (p) { return p.slug; }).join('、'));
}
console.log('已更新 sitemap.xml、robots.txt');
