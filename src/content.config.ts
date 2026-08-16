import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 攻略集合：src/content/guides/ 下的所有 .md 文件自动成为一篇攻略
 * 新增攻略 = 新建一个 .md 文件，无需改动任何代码
 *
 * 两级分类体系：
 *   category    一级分类（缺氧 / CS / 站点教程）
 *   subcategory 二级分类（缺氧: 气泉 / 水泉；CS: 道具 / 站位），可选
 */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),                                    // 攻略标题
    description: z.string(),                              // 摘要（列表页 & SEO 用）
    category: z.enum(['缺氧', 'CS', '站点教程']),         // 一级分类
    subcategory: z.string().optional(),                   // 二级分类（自由字符串：来自语雀目录名 或 手工填写）
    game: z.string().optional(),                          // 兼容旧字段（可选）
    date: z.coerce.date(),                                // 发布日期
    tags: z.array(z.string()).default([]),                // 标签
    cover: z.string().optional(),                         // 封面图
    pinned: z.boolean().default(false),                   // 置顶
    manual: z.boolean().default(false),                   // 手工写的文章（语雀同步 prune 时不会误删）
    yuque_url: z.string().optional(),                     // 语雀原文链接
  }),
});

export const collections = { guides };
