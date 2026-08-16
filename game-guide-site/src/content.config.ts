import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 攻略集合：src/content/guides/ 下的所有 .md 文件自动成为一篇攻略
 * 新增攻略 = 新建一个 .md 文件，无需改动任何代码
 */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),              // 攻略标题
    description: z.string(),        // 摘要（列表页 & SEO 用）
    game: z.string(),               // 所属游戏名
    date: z.coerce.date(),          // 发布日期，如 2026-08-15
    tags: z.array(z.string()).default([]),  // 标签，可选
    cover: z.string().optional(),   // 封面图路径，可选，如 /images/xx.jpg
    pinned: z.boolean().default(false), // 置顶，可选
  }),
});

export const collections = { guides };
