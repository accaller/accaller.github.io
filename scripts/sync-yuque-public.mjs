#!/usr/bin/env node
/**
 * 语雀公开同步脚本（不需要 Token / 不需要会员）
 *
 * 原理：
 *   1. 访问知识库里任意一篇文档的公开页面 → HTML 里嵌入了 window.appData
 *   2. appData.book.toc 包含完整的文档目录树（标题/URL/层级）
 *   3. 调用语雀公开 API 获取每篇文档的 content（Lake 格式）
 *   4. 将 Lake 格式转换为 Markdown
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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'yuque-source.json');
const CONTENT_DIR = join(ROOT, 'src/content/guides');
const YUQUE_BASE = 'https://www.yuque.com';

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
      // 尝试提取有意义的文本
      return data.text || data.content || data.title || fallback || '';
    } catch (e) {
      return fallback || '';
    }
  });
  // 自闭合 card
  md = md.replace(/<card[^>]*\/>/gi, '');

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

  let fm = `---
title: ${escapeYaml(doc.title)}
description: ${escapeYaml(doc.description || doc.custom_description || '暂无简介')}
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

function parseFrontmatterCategory(content) {
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
  if (!config.user || !Array.isArray(config.repos) || config.repos.length === 0) {
    console.error('✗ yuque-source.json 配置不完整');
    process.exit(1);
  }

  if (!existsSync(CONTENT_DIR)) {
    mkdirSync(CONTENT_DIR, { recursive: true });
  }

  console.log('🚀 开始语雀公开同步（无需 Token）\n');

  const allImportedSlugs = {}; // category -> Set of slugs

  for (const repo of config.repos) {
    const { repo: bookSlug, category, bootstrap } = repo;
    if (!bookSlug || !category || !bootstrap) {
      console.error(`✗ 配置不完整: ${JSON.stringify(repo)}`);
      continue;
    }

    console.log(`\n========== 同步知识库：${category}（${bookSlug}）==========`);

    // 1. 获取 TOC（通过 bootstrap 文档页面）
    const bootstrapUrl = `${YUQUE_BASE}/${config.user}/${bookSlug}/${bootstrap}`;
    console.log(`📥 获取目录结构: ${bootstrapUrl}`);
    const html = await fetchText(bootstrapUrl, {
      Referer: YUQUE_BASE,
    });
    const appData = extractAppData(html);
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

    if (!allImportedSlugs[category]) allImportedSlugs[category] = new Set();

    // 3. 逐篇获取内容并生成 .md
    for (const doc of docs) {
      const slug = slugify(doc.title, doc.subcategory);
      allImportedSlugs[category].add(slug);
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
        console.warn(`  ⚠ 跳过（无法公开访问）: ${doc.title} — 请在语雀知识库设置中开启「公开访问」`);
        allImportedSlugs[category].delete(slug);
        continue;
      }

      const content = docData.content || '';
      const description = docData.description || '';
      const markdown = lakeToMarkdown(content);

      const fullDoc = {
        title: doc.title,
        slug: doc.slug,
        description,
        published_at: docData.published_at,
        created_at: docData.created_at,
      };

      const fm = generateFrontmatter(fullDoc, category, doc.subcategory, bookSlug, config.user);
      const fileContent = fm + markdown + '\n';

      if (dryRun) {
        console.log(`  [DRY-RUN] ${slug}.md [${doc.subcategory || 'root'}] (${markdown.length} chars)`);
        continue;
      }

      writeFileSync(targetPath, fileContent, 'utf-8');
      console.log(`  ✅ ${slug}.md [${doc.subcategory || 'root'}] (${markdown.length} chars)`);
    }

    // 4. Prune：删除该分类下、不在 TOC 中的、非 manual 的 .md 文件
    if (!dryRun) {
      console.log(`\n🗑️  Prune: 清理 ${category} 分类下语雀已删除的文章...`);
      const existing = readdirSync(CONTENT_DIR).filter((f) => extname(f) === '.md');
      let pruned = 0;
      for (const f of existing) {
        const slugName = basename(f, '.md');
        if (allImportedSlugs[category].has(slugName)) continue;
        const filePath = join(CONTENT_DIR, f);
        const raw = readFileSync(filePath, 'utf-8');
        const meta = parseFrontmatterCategory(raw);
        if (meta.category !== category) continue;
        if (meta.manual) {
          console.log(`  🛡  保留（manual）: ${f}`);
          continue;
        }
        unlinkSync(filePath);
        console.log(`  ❌ 删除: ${f}`);
        pruned++;
      }
      if (pruned === 0) console.log(`  无需清理。`);
    }
  }

  console.log('\n✅ 同步完成！');
  if (dryRun) console.log('(DRY-RUN 模式：未实际写文件)');
}

main().catch((e) => {
  console.error('同步失败:', e);
  process.exit(1);
});
