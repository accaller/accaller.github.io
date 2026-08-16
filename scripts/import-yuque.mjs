#!/usr/bin/env node
/**
 * 语雀导出 Markdown 批量导入脚本
 *
 * 用途：把语雀导出的 .md 文件批量转换成 Astro 攻略站可用的格式
 *       支持读取语雀目录层级 → 自动映射为 subcategory（二级分类）
 *
 * 用法：
 *   node scripts/import-yuque.mjs <语雀导出目录> <一级分类> [--update] [--prune]
 *
 * 示例：
 *   # 首次导入「缺氧」知识库（subcategory 从导出的目录名推断）
 *   node scripts/import-yuque.mjs ./export/缺氧 缺氧
 *
 *   # 日常同步：保留原 frontmatter，只刷新正文；且删除 guides 中语雀已删除的文件
 *   node scripts/import-yuque.mjs ./export/缺氧 缺氧 --update --prune
 *
 * 语雀目录 → 站点分类 映射例子：
 *   导出目录/水泉/盐水泉.md      → category=缺氧, subcategory=水泉, slug=水泉-盐水泉
 *   导出目录/农牧/浆果糕.md        → category=缺氧, subcategory=农牧, slug=农牧-浆果糕
 *   导出目录/火箭.md              → category=缺氧, subcategory=undefined, slug=火箭
 *
 * prune 规则（--prune 开启）：
 *   遍历 src/content/guides/ 下所有 category=<一级分类> 且 frontmatter 未标记 !manual=true
 *   的文件；若其 slug 不在「本轮从语雀导入的 slug 列表」中，就删掉。
 *
 * 防止误删的手工白名单：
 *   如果某个 .md 文件是你手工写的（不是语雀同步来的），在 frontmatter 里加 `manual: true`，
 *   就不会被 --prune 误删。
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync, readlinkSync } from 'node:fs';
import { join, basename, extname, resolve, relative, sep } from 'node:path';

const CONTENT_DIR = resolve(process.cwd(), 'src/content/guides');

// ==================== 工具函数 ====================

/** 递归扫描目录下所有 .md 文件，返回相对 sourceDir 的路径列表 */
function findMdFiles(dir, rootDir = dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findMdFiles(fullPath, rootDir));
    } else if (extname(entry).toLowerCase() === '.md') {
      results.push(relative(rootDir, fullPath));
    }
  }
  return results;
}

/** 从相对路径（语雀导出目录内部的路径）解析出 subcategory 和 slug */
function parseRelPath(relPath) {
  const parts = relPath.split(sep);
  // parts 示例：['水泉', '盐水泉.md'] 或 ['农牧', '浆果糕.md'] 或 ['火箭.md']
  if (parts.length <= 1) {
    return { subcategory: undefined, slug: slugify(parts[0]) };
  }
  // 嵌套一级子目录，subcategory 是第一层目录名；slug 用「目录名-文件名」避免重名
  const subcategory = parts[0];
  const filename = parts.slice(1).join('-');
  return { subcategory, slug: slugify(`${subcategory}-${filename}`) };
}

/** 从文件名生成 slug（保留中文，只处理空格和特殊字符） */
function slugify(filename) {
  return basename(filename, '.md')
    .replace(/\s+/g, '-')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/^-+|-+$/g, '');
}

/** 从 Markdown 正文提取第一个 # 标题作为 title */
function extractTitle(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return basename(fallback, '.md');
}

/** 尝试从正文第一段提取摘要（最多 100 字） */
function extractDescription(content) {
  const text = content
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/^#+\s+.+$/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .trim();
  const firstPara = text.split(/\n\n/)[0]?.replace(/\n/g, ' ').trim() ?? '';
  return firstPara.slice(0, 100) || '暂无简介';
}

/** 生成 frontmatter */
function generateFrontmatter(title, description, category, subcategory, date, tags) {
  let fm = `---
title: ${escapeYaml(title)}
description: ${escapeYaml(description)}
category: ${escapeYaml(category)}
`;
  if (subcategory) {
    fm += `subcategory: ${escapeYaml(subcategory)}
`;
  }
  fm += `date: ${date}
tags: [${tags.map((t) => escapeYaml(t)).join(', ')}]
---

`;
  return fm;
}

function escapeYaml(str) {
  if (str == null) return '""';
  if (/[:\#"'\[\]{}]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

function hasFrontmatter(content) {
  return content.startsWith('---');
}

function extractFrontmatterBlock(content) {
  if (!hasFrontmatter(content)) return '';
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? match[0] : '';
}

function stripFrontmatter(content) {
  return content.slice(extractFrontmatterBlock(content).length);
}

/** 解析 frontmatter 的 category 和 manual 字段（用于 prune） */
function parseFrontmatter(content) {
  const block = extractFrontmatterBlock(content);
  const result = { category: '', manual: false };
  if (!block) return result;
  for (const line of block.split(/\r?\n/)) {
    const catMatch = line.match(/^category:\s*(.+)$/);
    if (catMatch) {
      let v = catMatch[1].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
      result.category = v;
    }
    if (/^manual:\s*true/.test(line)) result.manual = true;
  }
  return result;
}

// ==================== 主逻辑 ====================

function main() {
  const argv = process.argv.slice(2);
  const updateMode = argv.includes('--update');
  const pruneMode = argv.includes('--prune');
  const positional = argv.filter((a) => !a.startsWith('--'));

  const sourceDir = positional[0];
  const category = positional[1];

  if (!sourceDir || !category) {
    console.error('用法: node scripts/import-yuque.mjs <语雀导出目录> <一级分类> [--update] [--prune]');
    console.error('示例: node scripts/import-yuque.mjs ./export/缺氧 缺氧 --update --prune');
    process.exit(1);
  }

  const sourcePath = resolve(sourceDir);
  if (!existsSync(sourcePath)) {
    console.error(`✗ 目录不存在: ${sourcePath}`);
    process.exit(1);
  }

  const today = new Date().toISOString().split('T')[0];

  if (!existsSync(CONTENT_DIR)) {
    mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const relFiles = findMdFiles(sourcePath);
  if (relFiles.length === 0) {
    console.error(`✗ 在 ${sourcePath} 下没有找到 .md 文件`);
    process.exit(1);
  }

  console.log(`\n🎮 导入任务：${category}`);
  console.log(`📂 源目录：${sourcePath}`);
  console.log(`📄 找到 ${relFiles.length} 个 .md 文件\n`);

  const importedSlugs = new Set();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const results = [];

  for (const rel of relFiles) {
    const fullPath = join(sourcePath, rel);
    let content = readFileSync(fullPath, 'utf-8');
    const parsed = parseRelPath(rel);
    const slug = parsed.slug;
    const subcategory = parsed.subcategory;
    importedSlugs.add(slug);

    const targetPath = join(CONTENT_DIR, `${slug}.md`);

    // 已存在：--update 模式只刷新正文；否则跳过
    if (existsSync(targetPath)) {
      if (!updateMode) {
        console.log(`  ⏭  跳过（已存在）: ${slug}.md${subcategory ? ` [${subcategory}]` : ''}`);
        skipped++;
        results.push({ file: slug, subcategory, status: 'skipped' });
        continue;
      }

      const existing = readFileSync(targetPath, 'utf-8');
      const preservedFrontmatter = extractFrontmatterBlock(existing);
      const sourceBody = stripFrontmatter(content);

      const merged = preservedFrontmatter.replace(/\n?$/, '\n') + '\n' + sourceBody;
      if (merged === existing) {
        console.log(`  ⏭  无变化: ${slug}.md${subcategory ? ` [${subcategory}]` : ''}`);
        skipped++;
        results.push({ file: slug, subcategory, status: 'unchanged' });
        continue;
      }

      writeFileSync(targetPath, merged, 'utf-8');
      console.log(`  🔄 更新（保留原信息头）: ${slug}.md${subcategory ? ` [${subcategory}]` : ''}`);
      updated++;
      results.push({ file: slug, subcategory, status: 'updated' });
      continue;
    }

    // 新文件：补上 frontmatter（subcategory 取自语雀目录层级）
    if (!hasFrontmatter(content)) {
      const title = extractTitle(content, rel);
      const description = extractDescription(content);
      const frontmatter = generateFrontmatter(title, description, category, subcategory, today, []);
      content = frontmatter + content;
    }

    writeFileSync(targetPath, content, 'utf-8');
    console.log(`  ✅ 导入: ${slug}.md${subcategory ? ` [${subcategory}]` : ''}`);
    imported++;
    results.push({ file: slug, subcategory, status: 'imported' });
  }

  // prune 模式：删除该分类下、不是 manual、且不在本次导入列表中的文件
  let prunedCount = 0;
  if (pruneMode) {
    console.log(`\n🗑️   PRUNE 模式：清理 category=${category} 且语雀中已不存在的文章...`);
    const existing = readdirSync(CONTENT_DIR).filter((f) => extname(f).toLowerCase() === '.md');
    for (const f of existing) {
      const slug = basename(f, '.md');
      if (importedSlugs.has(slug)) continue; // 本次导入过，留
      const targetPath = join(CONTENT_DIR, f);
      const raw = readFileSync(targetPath, 'utf-8');
      const meta = parseFrontmatter(raw);
      if (meta.category !== category) continue; // 不是本次同步的分类，不管
      if (meta.manual) {
        console.log(`  🛡  保留（manual=true）: ${f}`);
        continue;
      }
      unlinkSync(targetPath);
      console.log(`  ❌ 删除: ${f}`);
      prunedCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`✅ 导入${imported} 篇，更新${updated} 篇，跳过${skipped} 篇${pruneMode ? `，删除${prunedCount} 篇` : ''}`);
  console.log(`========================================`);

  const reportPath = join(process.cwd(), 'import-report.json');
  writeFileSync(reportPath, JSON.stringify({ category, date: today, pruned: prunedCount, results }, null, 2), 'utf-8');
  console.log(`\n📋 清单: ${reportPath}`);
}

main();
