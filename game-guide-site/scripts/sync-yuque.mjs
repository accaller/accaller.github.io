#!/usr/bin/env node
/**
 * 语雀自动同步脚本（主要在 GitHub Actions 里运行，也可本地手动跑）
 *
 * 用法：
 *   YUQUE_TOKEN=xxx node scripts/sync-yuque.mjs
 *
 * 它会做什么：
 *   1. 读取 yuque.config.json 里的知识库列表
 *   2. 下载 yuque-exporter（Linux 版，已下载则复用）
 *   3. 逐个知识库导出最新 Markdown 到 .yuque-cache/
 *   4. 以 --update 模式运行导入脚本（保留已有 frontmatter，只刷新正文）
 *   5. 是否有变化交给 git 判断（workflow 里检测 git status 再决定是否提交）
 *
 * 环境变量：
 *   YUQUE_TOKEN        必填，语雀 Token（https://www.yuque.com/settings/tokens）
 *   YUQUE_EXPORTER_BIN 可选，本地已有导出工具时直接指定路径（跨平台本地调试用）
 */

import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'yuque.config.json');
const CACHE_DIR = join(ROOT, '.yuque-cache');
const EXPORTER_PATH = join(CACHE_DIR, 'yuque-exporter');

// GitHub Releases 的 latest 下载地址（linux-amd64，Actions runner 是 ubuntu）
const EXPORTER_URL =
  'https://github.com/bkm016/yuque-exporter/releases/latest/download/yuque-exporter-linux-amd64';

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function main() {
  // ---------- 前置检查 ----------
  const token = process.env.YUQUE_TOKEN;
  if (!token) {
    fail(
      '缺少 YUQUE_TOKEN 环境变量。\n' +
        '  · GitHub 上：仓库 Settings → Secrets and variables → Actions → New repository secret，名称 YUQUE_TOKEN，值填语雀 Token\n' +
        '  · 本地跑：YUQUE_TOKEN=你的token node scripts/sync-yuque.mjs\n' +
        '  · 语雀 Token 获取：https://www.yuque.com/settings/tokens'
    );
  }

  if (!existsSync(CONFIG_PATH)) {
    fail('找不到 yuque.config.json，请在项目根目录创建并填入 user / repos。');
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.user || !Array.isArray(config.repos) || config.repos.length === 0) {
    fail('yuque.config.json 配置不完整：需要 user（字符串）和 repos（至少一条）。');
  }
  if (config.user.includes('你的语雀用户名')) {
    fail('yuque.config.json 还是示例配置，请把 user / repos 改成你的真实信息。');
  }

  // ---------- 准备缓存目录 ----------
  mkdirSync(CACHE_DIR, { recursive: true });

  // ---------- 准备导出工具 ----------
  const exporterBin = process.env.YUQUE_EXPORTER_BIN || ensureExporter();

  // ---------- 逐库导出 + 导入 ----------
  for (const { repo, game } of config.repos) {
    if (!repo || !game) fail('yuque.config.json 中每条 repos 需要 repo 和 game 两个字段。');

    console.log(`\n========== 同步知识库：${game}（${repo}）==========`);

    const outDir = join(CACHE_DIR, repo);
    mkdirSync(outDir, { recursive: true });

    execSync(`${exporterBin} -token ${token} -user ${config.user} -repo ${repo} -output ${outDir} -format markdown`, {
      stdio: 'inherit',
    });

    // --update：保留已有 frontmatter，只刷新正文；新文档自动补信息头
    execSync(`node scripts/import-yuque.mjs ${outDir} ${game} --update`, {
      stdio: 'inherit',
      cwd: ROOT,
    });
  }

  console.log('\n✅ 全部知识库同步完成。是否有变化请查看 git status。');
  console.log('提示：语雀里删除的文档不会自动从网站移除，需要手动删除 src/content/guides/ 下对应文件。');
}

/** 下载 yuque-exporter（linux 版）；本地调试可用 YUQUE_EXPORTER_BIN 跳过 */
function ensureExporter() {
  if (existsSync(EXPORTER_PATH)) return EXPORTER_PATH;

  console.log('⬇️  下载 yuque-exporter ...');
  mkdirSync(CACHE_DIR, { recursive: true });
  execSync(`curl -fL --retry 3 -o ${EXPORTER_PATH} ${EXPORTER_URL}`, { stdio: 'inherit' });
  execSync(`chmod +x ${EXPORTER_PATH}`);
  return EXPORTER_PATH;
}

main();
