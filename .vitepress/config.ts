import { defineConfig } from 'vitepress';

// GitHub Pages base path: set via GITHUB_PAGES_BASE env or default to '/'
const base = process.env.GITHUB_PAGES_BASE || '/';

export default defineConfig({
  title: 'throttled-nodejs',
  description: 'High-performance Node.js rate limiting library',
  lang: 'zh-CN',

  base,

  themeConfig: {
    logo: false,

    nav: [
      { text: '首页', link: '/' },
      { text: 'GitHub', link: 'https://github.com/ZhuoZhuoCrayon/throttled-nodejs' },
    ],

    sidebar: [
      {
        text: '入门',
        items: [
          { text: '简介', link: '/' },
          { text: '安装', link: '/installation' },
        ],
      },
      {
        text: '快速开始',
        items: [
          { text: '函数调用', link: '/quickstart/function-call' },
          { text: '装饰器', link: '/quickstart/decorator' },
          { text: '上下文管理器', link: '/quickstart/context-manager' },
          { text: '等待重试', link: '/quickstart/wait-retry' },
          { text: '存储后端', link: '/quickstart/store-backends' },
          { text: '指定算法', link: '/quickstart/specifying-algorithms' },
          { text: '配额配置', link: '/quickstart/quota-configuration' },
        ],
      },
      {
        text: '进阶用法',
        items: [
          { text: 'Hook 中间件', link: '/advance_usage/hooks' },
          { text: '存储配置', link: '/advance_usage/store-configuration' },
        ],
      },
      {
        text: '可观测性',
        items: [
          { text: 'OpenTelemetry', link: '/observability/opentelemetry' },
        ],
      },
      {
        text: '更多',
        items: [
          { text: 'API 参考', link: '/api-reference' },
          { text: '基准测试', link: '/benchmarks' },
          { text: '变更日志', link: '/changelog' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ZhuoZhuoCrayon/throttled-nodejs' },
    ],

    footer: {
      message: 'MIT License — Port of throttled-py',
    },
  },
});
