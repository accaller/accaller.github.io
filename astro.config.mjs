// @ts-check
import { defineConfig } from 'astro/config';

// ==================== 上线前必看 ====================
// 场景 A（推荐）：GitHub 仓库命名为 <你的用户名>.github.io
//   → site 改成 https://<你的用户名>.github.io，base 保持 '/'
//
// 场景 B：仓库是其他名字（如 game-guide-site）
//   → site 保持 https://<你的用户名>.github.io
//   → base 改成 '/game-guide-site'（即 '/仓库名'）
// ====================================================
export default defineConfig({
  site: 'https://accaller.github.io',
  base: '/',
});
