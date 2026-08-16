#!/usr/bin/env node
/**
 * 语雀公开同步脚本（不需要 Token / 不需要会员）
 *
 * 原理：
 *   1. 访问知识库里任意一篇文档的公开页面 → HTML 里嵌入了 window.appData
 *   2. appData.book.toc 包含完整的文档目录树（标题/URL/层级）
 *   3. 调用语雀公开 API 获取每篇文档的 content（Lake 格式）
 *   4. 将 Lake 格式转换为 Markdown，并把语雀 CDN 图片下载到本地 public/images/yuque/
 *   5. 生成 .md 文件到 src/content/guides/
 *   6. 删除语雀中已不存在的文章（prune）
 *
 * 用法：
 *   node scripts/sync-yuque-public.mjs           # 同步所有知识库
 *   node scripts/sync-yuque-public.mjs --dry-run  # 只打印不写文件
 *
 * 配置：yuque-source.json
 * 环境变量：无需（不需要 Token）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, createWriteStream } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'yuque-source.json');
const CONTENT_DIR = join(ROOT, 'src/content/guides');
const YUQUE_BASE = 'https://www.yuque.com';
const IMAGE_OUT_DIR = join(ROOT, 'public/images/yuque');
const IMAGE_WEB_PREFIX = '/images/yuque/';

// ==================== HTTP 工具 ====================

async function fetchText(url, headers = {}) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Accept': 'text/html,application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...headers,
    },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${url}`);
  }
  return resp.text();
}

async function fetchJSON(url, headers = {}) {
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

async function downloadBinary(url, dest) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://www.yuque.com/',
    },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${url}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

// ==================== 解析 appData ====================

function extractAppData(html) {
  // appData 格式：window.appData = JSON.parse(decodeURIComponent("..."));
  const m = html.match(/window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\("(.+?)"\)\)/);
  if (!m) {
    // 备选格式：window.appData = {...};
    const m2 = html.match(/window\.appData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!m2) return null;
    try {
      return JSON.parse(m2[1]);
    } catch {
      return null;
    }
  }
  // URL-decode
  const encoded = m[1].replace(/\\"/g, '"');
  const decoded = decodeURIComponent(encoded);
  return JSON.parse(decoded);
}

/** 从 appData 中提取 book + toc */
function parseTocFromAppData(appData) {
  const book = appData?.book;
  if (!book) return null;
  return {
    bookId: book.id,
    bookName: book.name,
    bookSlug: book.slug,
    toc: book.toc || [],
  };
}

/**
 * 把扁平 TOC 转成层级结构
 * 返回：[{ type, title, url, subcategory, visible }]
 */
function buildTocTree(toc) {
  // 先收集所有 TITLE 节点（目录名 = subcategory）
  const titleMap = {}; // uuid -> title
  for (const item of toc) {
    if (item.type === 'TITLE') {
      titleMap[item.uuid] = item.title;
    }
  }

  const docs = [];
  for (const item of toc) {
    if (item.type !== 'DOC') continue;
    if (item.visible === 0) continue; // 隐藏的跳过
    const parentUuid = item.parent_uuid || '';
    const subcategory = titleMap[parentUuid] || ''; // 父 TITLE 节点 = subcategory
    docs.push({
      title: item.title,
      slug: item.url, // 语雀文档的 slug
      docId: item.doc_id,
      subcategory: subcategory || undefined,
      visible: item.visible !== 0,
    });
  }
  return docs;
}

// ==================== 图片本地化 ====================

function md5(str) {
  return createHash('md5').update(str).digest('hex').slice(0, 12);
}

/** 提取图片 URL 中的扩展名，无扩展名则按内容类型推断 */
function guessImageExt(url, contentType) {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i);
  if (m) return '.' + m[1].toLowerCase();
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('png')) return '.png';
    if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
    if (ct.includes('gif')) return '.gif';
    if (ct.includes('webp')) return '.webp';
    if (ct.includes('svg')) return '.svg';
  }
  return '.png'; // 语雀图片多为 png
}

/**
 * 把 Markdown 中所有语雀 CDN 图片下载到本地
 * 返回 { markdown: 替换后的内容, count: 下载数量 }
 */
async function localizeImages(markdown, dryRun) {
  if (!existsSync(IMAGE_OUT_DIR)) mkdirSync(IMAGE_OUT_DIR, { recursive: true });

  // 匹配 ![alt](https://... 语雀 CDN 域名 或 mdn.alipayobjects)
  const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let count = 0;
  let skipped = 0;
  const mdNew = markdown.replace(imgRegex, (match, alt, url) => {
    // 判断是否为需要下载的外链图（语雀CDN/支付宝CDN/其他CDN，只要 http 的都下载，避免防盗链）
    if (!/^https?:\/\//.test(url)) return match; // 已经是本地路径，跳过

    const ext = guessImageExt(url, '');
    const key = md5(url);
    const fileName = `${key}${ext}`;
    const localPath = join(IMAGE_OUT_DIR, fileName);
    const webPath = `${IMAGE_WEB_PREFIX}${fileName}`;

    if (!existsSync(localPath)) {
      // 异步串行下载（这里先记下任务）
      if (!dryRun) {
        _imgDLTasks.push({ url, localPath, name: fileName });
      }
    }
    count++;
    return `![${alt || fileName}](${webPath})`;
  });

  // 真正执行下载（异步，串行避免并发太高触发反爬）
  if (!dryRun && _imgDLTasks.length) {
    console.log(`    🖼️  下载 ${_imgDLTasks.length} 张图片...`);
    for (let i = 0; i < _imgDLTasks.length; i++) {
      const t = _imgDLTasks[i];
      try {
        const bytes = await downloadBinary(t.url, t.localPath);
        console.log(`      ${i + 1}/${_imgDLTasks.length} ${t.name} (${(bytes / 1024).toFixed(1)}KB)`);
      } catch (e) {
        console.warn(`      ⚠ ${t.name} 下载失败: ${e.message}`);
      }
    }
    _imgDLTasks = [];
  }

  return { markdown: mdNew, count, skipped };
}

let _imgDLTasks = [];

// ==================== Lake → Markdown 转换 ====================

/** 把语雀 Lake 格式内容转换为 Markdown */
function lakeToMarkdown(lakeHtml) {
  if (!lakeHtml || typeof lakeHtml !== 'string') return '';

  let md = lakeHtml;

  // 去掉开头的 <!doctype lake> 和 <meta> 标签
  md = md.replace(/<!doctype[^>]*>/gi, '');
  md = md.replace(/<meta[^>]*\/?>/gi, '');

  // 处理图片 card
  // <card type="inline" name="image" value="data:%7B...%7D">
  md = md.replace(/<card[^>]*name="image"[^>]*value="data:([^"]+)"[^>]*>/gi, (match, encoded) => {
    try {
      const decoded = decodeURIComponent(encoded);
      const data = JSON.parse(decoded);
      const src = data.src || '';
      const name = data.name || 'image';
      if (src) return `\n\n![${name}](${src})\n\n`;
    } catch (e) {
      // ignore parse errors
    }
    return '';
  });

  // 处理其他 block card（代码块等）
  // <card type="block" name="codeblock" value="data:...">
  md = md.replace(/<card[^>]*name="codeblock"[^>]*value="data:([^"]+)"[^>]*>/gi, (match, encoded) => {
    try {
      const decoded = decodeURIComponent(encoded);
      const data = JSON.parse(decoded);
      const lang = data.language || '';
      const code = data.code || data.mode || '';
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    } catch (e) {
      return '';
    }
  });

  // 处理其他 card（表格、数学公式等）→ 提取纯文本
  md = md.replace(/<card[^>]*value="data:([^"]+)"[^>]*>([\s\S]*?)<\/card>/gi, (match, encoded, fallback) => {
    try {
      const decoded = decodeURIComponent(encoded);
      const data = JSON.parse(decoded);
      return data.text || data.content || data.title || fallback || '';
    } catch (e) {
      return fallback || '';
    }
  });
  // 自闭合 card
  md = md.replace(/<card[^>]*\/>/gi, '');

  // 处理 <img> 普通标签（兜底）
  md = md.replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*\/?\s*>/gi, '\n\n![$2]($1)\n\n');
  md = md.replace(/<img[^>]*src="([^"]+)"[^>]*\/?\s*>/gi, '\n\n![image]($1)\n\n');

  // 处理标题
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');

  // 处理列表
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // 处理加粗/斜体
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // 处理链接
  md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 处理段落
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // 处理 span：提取内容，丢弃样式
  md = md.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1');

  // 处理换行
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // 处理引用
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    return '\n' + content.trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
  });

  // 去掉剩余 HTML 标签
  md = md.replace(/<div[^>]*>/gi, '\n');
  md = md.replace(/<\/div>/gi, '\n');
  md = md.replace(/<[^>]+>/g, '');

  // HTML 实体解码
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // 清理多余空行
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

// ==================== frontmatter 生成 ====================

function escapeYaml(str) {
  if (str == null) return '""';
  str = String(str);
  if (/[:#"'\[\]{}\n]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

function generateFrontmatter(doc, category, subcategory, bookSlug, userSlug) {
  const yuqueUrl = `${YUQUE_BASE}/${userSlug}/${bookSlug}/${doc.slug}`;
  const date = doc.published_at || doc.created_at || new Date().toISOString();
  const dateStr = typeof date === 'string' ? date.split('T')[0] : new Date().toISOString().split('T')[0];

  // description: 截断正文前 60 字，防止空描述
  let desc = doc.description || doc.custom_description || '';
  desc = desc.replace(/\s+/g, ' ').trim();
  if (!desc && doc.bodyText) {
    desc = doc.bodyText.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  if (!desc) desc = '暂无简介';

  let fm = `---
title: ${escapeYaml(doc.title)}
description: ${escapeYaml(desc)}
category: ${escapeYaml(category)}
`;
  if (subcategory) {
    fm += `subcategory: ${escapeYaml(subcategory)}
`;
  }
  fm += `date: ${dateStr}
tags: []
yuque_url: ${yuqueUrl}
---

`;
  return fm;
}

// ==================== slug 生成 ====================

function slugify(title, subcategory) {
  let base = subcategory ? `${subcategory}-${title}` : title;
  return base
    .replace(/\s+/g, '-')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/\//g, '-');
}

// ==================== frontmatter 解析（用于 prune） ====================

function parseFrontmatterMeta(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { category: '', manual: false };
  const block = m[1];
  let category = '';
  let manual = false;
  for (const line of block.split('\n')) {
    const cm = line.match(/^category:\s*(.+)$/);
    if (cm) {
      let v = cm[1].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      category = v;
    }
    if (/^manual:\s*true/.test(line)) manual = true;
  }
  return { category, manual };
}

// ==================== 主逻辑 ====================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(CONFIG_PATH)) {
    console.error('✗ 找不到 yuque-source.json');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.user || !Array.isArray(config.repos)) {
    console.error('✗ yuque-source.json 配置不完整');
    process.exit(1);
  }

  if (!existsSync(CONTENT_DIR)) {
    mkdirSync(CONTENT_DIR, { recursive: true });
  }

  console.log('🚀 开始语雀公开同步（无需 Token）\n');

  const importedFiles = new Set(); // 所有同步来的 slug（无扩展名）

  for (const repo of config.repos) {
    const { repo: bookSlug, category, bootstrap } = repo;
    if (!bookSlug || !category) {
      console.error(`✗ 配置不完整: ${JSON.stringify(repo)}`);
      continue;
    }
    // bootstrap 可选：如果没有，说明暂时还没文档，跳 TOC 步骤（但仍需 prune，所以不跳过）
    if (!bootstrap) {
      console.log(`\n========== 知识库：${category}（${bookSlug}）暂无 bootstrap 文档，跳过同步 ==========`);
      continue;
    }

    console.log(`\n========== 同步知识库：${category}（${bookSlug}）==========`);

    // 1. 获取 TOC（通过 bootstrap 文档页面）
    const bootstrapUrl = `${YUQUE_BASE}/${config.user}/${bookSlug}/${bootstrap}`;
    console.log(`📥 获取目录结构: ${bootstrapUrl}`);
    let appData;
    try {
      const html = await fetchText(bootstrapUrl, { Referer: YUQUE_BASE });
      appData = extractAppData(html);
    } catch (e) {
      console.error(`✗ 无法访问 bootstrap 文档：${e.message}（请确认该文档已设为公开）`);
      continue;
    }
    if (!appData) {
      console.error(`✗ 无法从页面提取 appData`);
      continue;
    }
    const bookInfo = parseTocFromAppData(appData);
    if (!bookInfo) {
      console.error(`✗ 无法获取 book/toc 信息`);
      continue;
    }

    console.log(`📚 知识库: ${bookInfo.bookName} (id=${bookInfo.bookId})`);

    // 2. 构建文档列表
    const docs = buildTocTree(bookInfo.toc);
    console.log(`📄 找到 ${docs.length} 篇文档\n`);

    // 3. 逐篇获取内容并生成 .md
    for (const doc of docs) {
      const slug = slugify(doc.title, doc.subcategory);
      importedFiles.add(slug);
      const targetPath = join(CONTENT_DIR, `${slug}.md`);

      // 调用语雀公开 API 获取文档内容
      const apiUrl = `${YUQUE_BASE}/api/docs/${doc.slug}?book_id=${bookInfo.bookId}&include_content=true`;
      let docData;
      try {
        const apiResp = await fetchJSON(apiUrl, {
          Referer: `${YUQUE_BASE}/${config.user}/${bookSlug}/${doc.slug}`,
        });
        docData = apiResp.data || apiResp;
      } catch (e) {
        console.warn(`  ⚠ 跳过（无法公开访问）: ${doc.title} — 请在语雀将该文档设为公开`);
        importedFiles.delete(slug);
        continue;
      }

      const content = docData.content || '';
      let markdown = lakeToMarkdown(content);

      // 3.1 图片本地化（下载到 public/images/yuque 并替换 URL）
      const { count, markdown: mdLocalized } = await localizeImages(markdown, dryRun);
      markdown = mdLocalized;

      const bodyText = markdown.replace(/[#>*_`~\-\[\]()!]/g, '').slice(0, 200);

      const fullDoc = {
        title: doc.title,
        slug: doc.slug,
        description: docData.description,
        published_at: docData.published_at,
        created_at: docData.created_at,
        bodyText,
      };

      const fm = generateFrontmatter(fullDoc, category, doc.subcategory, bookSlug, config.user);
      const fileContent = fm + markdown + '\n';

      if (dryRun) {
        console.log(`  [DRY-RUN] ${slug}.md [${doc.subcategory || 'root'}] (${markdown.length} chars, ${count} imgs)`);
        continue;
      }

      writeFileSync(targetPath, fileContent, 'utf-8');
      console.log(`  ✅ ${slug}.md [${doc.subcategory || 'root'}] (${markdown.length} chars, ${count} imgs)`);
    }
  }

  // 4. 统一 Prune：遍历所有 .md，同步没来的且非 manual=true 的全删（category 不限，跨 category 的多余文章也清理）
  console.log(`\n🗑️  Prune: 清理语雀已删除的文章（仅保留 manual=true）...`);
  const existing = readdirSync(CONTENT_DIR).filter((f) => extname(f) === '.md');
  let pruned = 0;
  for (const f of existing) {
    const slugName = basename(f, '.md');
    const filePath = join(CONTENT_DIR, f);
    const raw = readFileSync(filePath, 'utf-8');
    const meta = parseFrontmatterMeta(raw);
    if (meta.manual) {
      console.log(`  🛡  保留（manual=true）: ${f}（category=${meta.category || '-'}）`);
      continue;
    }
    if (importedFiles.has(slugName)) continue;
    if (dryRun) {
      console.log(`  [DRY-RUN] 会删除: ${f}`);
    } else {
      unlinkSync(filePath);
      console.log(`  ❌ 删除: ${f}`);
    }
    pruned++;
  }
  if (pruned === 0) console.log(`  无需清理。`);

  console.log('\n✅ 同步完成！');
  if (dryRun) console.log('(DRY-RUN 模式：未实际写文件)');
}

main().catch((e) => {
  console.error('同步失败:', e);
  process.exit(1);
});
