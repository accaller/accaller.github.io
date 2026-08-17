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

// markdown 图片处理：
//   1. 给所有 <img> 自动加 loading="lazy" + decoding="async"
//   2. 把「整段只含一个图片」的 <p><img></p> 改写为
//      <figure><img><figcaption>alt</figcaption></figure>
//      这样 alt 文本会作为图片说明居中显示，跟语雀文档一致
function rehypeImages() {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type !== 'element') return;

      if (node.tagName === 'img') {
        const props = node.properties || (node.properties = {});
        if (props.loading == null) props.loading = 'lazy';
        if (props.decoding == null) props.decoding = 'async';
        return;
      }

      // 只处理「整段只含一个图片」的 p（markdown 渲染 ![]() 的典型产物）
      if (node.tagName === 'p' && node.children && node.children.length === 1) {
        const only = node.children[0];
        if (only.type === 'element' && only.tagName === 'img') {
          const alt = only.properties?.alt || '';
          // 改写 p → figure
          node.tagName = 'figure';
          node.properties = node.properties || {};
          // 保留原 p 上的属性（一般没有），但添加 figure 标识
          if (alt) {
            // 保留 alt 给 img（无障碍），figcaption 单独一份
            node.children.push({
              type: 'element',
              tagName: 'figcaption',
              properties: {},
              children: [{ type: 'text', value: String(alt) }],
            });
          }
        }
      }
    });
  };
}

// 带父节点和索引的遍历
function visit(node, fn, index = null, parent = null) {
  fn(node, index, parent);
  if (node.children && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      visit(node.children[i], fn, i, node);
    }
  }
}

export default defineConfig({
  site: 'https://accaller.github.io',
  base: '/',
  markdown: {
    rehypePlugins: [rehypeImages],
  },
});
