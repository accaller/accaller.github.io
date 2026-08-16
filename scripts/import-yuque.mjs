#!/usr/bin/env node
/**
 * 语雀导出 Markdown 批量导入脚本
 *
 * 用途：把语雀导出的 .md 文件批量转换成 Astro 攻略站可用的格式
 *
 * 用法：
 *   node scripts/import-yuque.mjs <语雀导出目录> [游戏名]
 *
 * 示例：
 *   node scripts/import-yuque.mjs ./export/原神 原神
 *   node scripts/import-yuque.mjs ./export/我的知识库
 *
 * 它会做什么：
 *   1. 扫描目录下所有 .md 文件
 *   2. 给每个文件自动补上 frontmatter（标题取自文件名或第一个 #，日期取今天）
 *   3. 把文件名转成 URL 友好的英文/拼音格式（保留中文也行，Astro 支持）
 *   4. 复制到 src/content/guides/ 目录
 *   5. 打印导入清单，你确认后 push 即可
 *
 * 安全说明：
 *   - 不会修改你语雀导出的原始文件
 *   - 目标目录已存在同名文件会跳过并提示
 *   - 所有操作都是本地文件复制，不联网
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, basename, extname, resolve, dirname } from 'node:path';

// ==================== 配置 ====================

const CONTENT_DIR = resolve(process.cwd(), 'src/content/guides');

// ==================== 工具函数 ====================

/** 递归扫描目录下所有 .md 文件 */
function findMdFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findMdFiles(fullPath));
    } else if (extname(entry).toLowerCase() === '.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/** 从文件名生成 slug（保留中文，只处理空格和特殊字符） */
function slugify(filename) {
  return basename(filename, '.md')
    .replace(/\s+/g, '-')        // 空格转连字符
    .replace(/[<>:"/\\|?*]/g, '') // 去掉文件系统非法字符
    .replace(/^-+|-+$/g, '');     // 去掉首尾连字符
}

/** 从 Markdown 正文提取第一个 # 标题作为 title */
function extractTitle(content, filename) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return basename(filename, '.md');
}

/** 尝试从正文第一段提取摘要（最多 100 字） */
function extractDescription(content) {
  // 去掉 frontmatter、标题、图片、链接，取第一段纯文本
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
function generateFrontmatter(title, description, game, date, tags) {
  return `---
title: ${escapeYaml(title)}
description: ${escapeYaml(description)}
game: ${escapeYaml(game)}
date: ${date}
tags: [${tags.map((t) => escapeYaml(t)).join(', ')}]
---

`;
}

/** 简单转义 YAML 字符串值（处理冒号、引号等） */
function escapeYaml(str) {
  if (/[:\#"'\[\]{}]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

/** 检查是否已有 frontmatter */
function hasFrontmatter(content) {
  return content.startsWith('---');
}

/** 提取文件开头的 frontmatter 块（含结尾 --- 和换行）；没有则返回空串 */
function extractFrontmatterBlock(content) {
  if (!hasFrontmatter(content)) return '';
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? match[0] : '';
}

/** 剥掉开头的 frontmatter 块，返回纯正文 */
function stripFrontmatter(content) {
  const block = extractFrontmatterBlock(content);
  return content.slice(block.length);
}

// ==================== 主逻辑 ====================

function main() {
  // --update 模式：自动同步时使用，已存在的文件保留原 frontmatter、只更新正文
  const argv = process.argv.slice(2);
  const updateMode = argv.includes('--update');
  const [sourceDir, gameName] = argv.filter((a) => !a.startsWith('--'));

  if (!sourceDir) {
    console.error('用法: node scripts/import-yuque.mjs <语雀导出目录> [游戏名] [--update]');
    console.error('示例: node scripts/import-yuque.mjs ./export/原神 原神');
    console.error('      node scripts/import-yuque.mjs ./export/原神 原神 --update   # 更新模式：保留已有 frontmatter，只刷新正文');
    process.exit(1);
  }

  const sourcePath = resolve(sourceDir);
  if (!existsSync(sourcePath)) {
    console.error(`✗ 目录不存在: ${sourcePath}`);
    process.exit(1);
  }

  const game = gameName || basename(sourcePath);
  const today = new Date().toISOString().split('T')[0];

  // 确保目标目录存在
  if (!existsSync(CONTENT_DIR)) {
    mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const mdFiles = findMdFiles(sourcePath);
  if (mdFiles.length === 0) {
    console.error(`✗ 在 ${sourcePath} 下没有找到 .md 文件`);
    process.exit(1);
  }

  console.log(`\n🎮 导入任务：${game}`);
  console.log(`📂 源目录：${sourcePath}`);
  console.log(`🎯 目标：${CONTENT_DIR}`);
  console.log(`📄 找到 ${mdFiles.length} 个 .md 文件\n`);

  let imported = 0;
  let skipped = 0;
  const results = [];

  for (const file of mdFiles) {
    let content = readFileSync(file, 'utf-8');
    const slug = slugify(file);
    const targetPath = join(CONTENT_DIR, `${slug}.md`);

    // 已存在文件：默认跳过；--update 模式下保留原 frontmatter、只刷新正文
    if (existsSync(targetPath)) {
      if (!updateMode) {
        console.log(`  ⏭  跳过（已存在）: ${slug}.md`);
        skipped++;
        results.push({ file: slug, status: 'skipped' });
        continue;
      }

      const existing = readFileSync(targetPath, 'utf-8');
      const preservedFrontmatter = extractFrontmatterBlock(existing);
      const sourceBody = stripFrontmatter(content);

      // 合并：保留原 frontmatter + 空行分隔 + 最新正文
      const merged = preservedFrontmatter.replace(/\n?$/, '\n') + '\n' + sourceBody;
      if (merged === existing) {
        console.log(`  ⏭  无变化: ${slug}.md`);
        skipped++;
        results.push({ file: slug, status: 'unchanged' });
        continue;
      }

      writeFileSync(targetPath, merged, 'utf-8');
      console.log(`  🔄 更新（保留原信息头）: ${slug}.md`);
      imported++;
      results.push({ file: slug, status: 'updated' });
      continue;
    }

    // 新文件：补上 frontmatter
    if (!hasFrontmatter(content)) {
      const title = extractTitle(content, file);
      const description = extractDescription(content);
      const frontmatter = generateFrontmatter(title, description, game, today, []);
      content = frontmatter + content;
    }

    writeFileSync(targetPath, content, 'utf-8');
    console.log(`  ✅ 导入: ${slug}.md`);
    imported++;
    results.push({ file: slug, status: 'imported' });
  }

  console.log(`\n========================================`);
  console.log(`✅ ${updateMode ? '同步' : '导入'}完成：${imported} 篇${updateMode ? '更新/新增' : '导入'}，${skipped} 篇跳过`);
  console.log(`========================================`);
  if (!updateMode) {
    console.log(`\n下一步：`);
    console.log(`  1. 检查 src/content/guides/ 下的文件，按需修改 frontmatter 里的 title/tags/date`);
    console.log(`  2. 如果有图片，把语雀的图片文件夹复制到 public/images/ 并修正路径`);
    console.log(`  3. git add . && git commit -m "import: ${game} 攻略" && git push`);
    console.log(`  4. 等 1-2 分钟，GitHub Actions 自动部署上线\n`);
  }

  // 输出 JSON 清单，方便程序化处理
  const reportPath = join(process.cwd(), 'import-report.json');
  writeFileSync(reportPath, JSON.stringify({ game, date: today, results }, null, 2), 'utf-8');
  console.log(`📋 导入清单已保存: ${reportPath}`);
}

main();
