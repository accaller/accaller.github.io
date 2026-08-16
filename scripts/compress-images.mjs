#!/usr/bin/env node
/**
 * 图片压缩脚本
 *
 * 作用：把 public/images/yuque/ 下的所有 PNG/JPG 压缩为 WebP
 *   - 限制最大宽度 1024px（超过则等比缩小）
 *   - 输出 quality 80 的 WebP（体积通常比 PNG 小 5~10 倍）
 *   - 原 PNG 保留但不再被网页引用（可后续手动清理）
 *
 * 同时扫描 src/content/guides/*.md，把 ![..](/images/yuque/xxx.png)
 * 改写成 ![..](/images/yuque/xxx.webp)
 *
 * 用法：
 *   node scripts/compress-images.mjs            # 压缩全部并改写 md
 *   node scripts/compress-images.mjs --dry-run  # 只打印不写文件
 */

import { readdirSync, existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const IMG_DIR = join(ROOT, 'public/images/yuque');
const GUIDES_DIR = join(ROOT, 'src/content/guides');
const MAX_WIDTH = 1024;
const QUALITY = 80;

const dryRun = process.argv.includes('--dry-run');

async function compressAll() {
  if (!existsSync(IMG_DIR)) {
    console.error(`✗ 目录不存在: ${IMG_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(IMG_DIR).filter((f) => /\.(png|jpe?g)$/i.test(extname(f)));
  console.log(`🖼️  发现 ${files.length} 张待压缩图片\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let converted = 0;
  const renameMap = new Map(); // oldName -> newName (含扩展名)

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const srcPath = join(IMG_DIR, file);
    const baseName = basename(file, extname(file));
    const outPath = join(IMG_DIR, `${baseName}.webp`);

    const before = statSync(srcPath).size;
    totalBefore += before;

    // 如果 webp 已存在且比源文件新，跳过
    if (existsSync(outPath) && statSync(outPath).mtimeMs > statSync(srcPath).mtimeMs) {
      const after = statSync(outPath).size;
      totalAfter += after;
      renameMap.set(file, `${baseName}.webp`);
      console.log(`  ${i + 1}/${files.length} ${file} → 已存在 .webp，跳过 (${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB)`);
      continue;
    }

    if (dryRun) {
      console.log(`  ${i + 1}/${files.length} [DRY-RUN] ${file} → ${baseName}.webp (${(before / 1024).toFixed(1)}KB)`);
      renameMap.set(file, `${baseName}.webp`);
      continue;
    }

    try {
      const info = await sharp(srcPath)
        .rotate() // 处理 EXIF 方向
        .resize({
          width: MAX_WIDTH,
          height: undefined,
          withoutEnlargement: true, // 小图不放大
          fit: 'inside',
        })
        .webp({ quality: QUALITY })
        .toFile(outPath);

      const after = statSync(outPath).size;
      totalAfter += after;
      renameMap.set(file, `${baseName}.webp`);
      converted++;
      console.log(`  ${i + 1}/${files.length} ${file} → ${baseName}.webp (${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB, ${info.width}x${info.height})`);

      // 删除原始文件（md 已不再引用），避免仓库里残留双份图片
      try {
        unlinkSync(srcPath);
      } catch {}
    } catch (e) {
      console.warn(`  ⚠ ${file} 压缩失败: ${e.message}`);
      renameMap.set(file, file); // 失败保留原名
    }
  }

  console.log(`\n📊 压缩统计：`);
  console.log(`   转换 ${converted} 张，跳过 ${files.length - converted} 张`);
  console.log(`   总体积 ${(totalBefore / 1024 / 1024).toFixed(2)}MB → ${(totalAfter / 1024 / 1024).toFixed(2)}MB`);
  console.log(`   节省 ${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}%\n`);

  // 改写 markdown 中的图片引用
  if (!existsSync(GUIDES_DIR)) {
    console.warn(`⚠ 找不到 ${GUIDES_DIR}，跳过 md 改写`);
    return;
  }

  const mdFiles = readdirSync(GUIDES_DIR).filter((f) => extname(f) === '.md');
  let mdChanged = 0;
  let mdRefs = 0;

  for (const md of mdFiles) {
    const mdPath = join(GUIDES_DIR, md);
    let content = readFileSync(mdPath, 'utf-8');
    let changed = false;

    for (const [oldName, newName] of renameMap) {
      if (oldName === newName) continue;
      // 匹配 /images/yuque/xxx.png 或 /images/yuque/xxx.jpg
      const oldPath = `/images/yuque/${oldName}`;
      const newPath = `/images/yuque/${newName}`;
      if (content.includes(oldPath)) {
        content = content.split(oldPath).join(newPath);
        changed = true;
        mdRefs++;
      }
    }

    if (changed && !dryRun) {
      writeFileSync(mdPath, content, 'utf-8');
      mdChanged++;
    }
  }

  console.log(`📝 Markdown 改写：${mdChanged} 个文件，${mdRefs} 处引用已更新为 .webp`);
  if (dryRun) console.log('(DRY-RUN 模式：未实际写文件)');
}

compressAll().catch((e) => {
  console.error('压缩失败:', e);
  process.exit(1);
});
