export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 路由匹配：仅处理 /proxy 路径的请求
    // 如果你希望整个 worker 只做代理，可以去掉这个判断
    if (url.pathname === '/proxy') {
      const targetUrl = url.searchParams.get('url');

      // 参数校验
      if (!targetUrl) {
        return new Response('Missing "url" parameter', { status: 400 });
      }

      // 安全校验：防止被当做通用代理工具
      if (!targetUrl.includes('doubanio.com')) {
        return new Response('Forbidden: Only Douban images are allowed', { status: 403 });
      }

      const cache = caches.default;
      // 检查缓存
      let response = await cache.match(request);

      if (!response) {
        // 2. 缓存未命中，构造请求去抓取豆瓣图片
        const doubanHeaders = new Headers();
        doubanHeaders.set('Referer', 'https://movie.douban.com/');
        doubanHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

        const imageRes = await fetch(targetUrl, {
          headers: doubanHeaders,
        });

        if (!imageRes.ok) {
          return new Response('Failed to fetch from source', { status: imageRes.status });
        }

        // 3. 修改响应头，以便 Cloudflare 和浏览器进行缓存
        const newHeaders = new Headers(imageRes.headers);
        
        // 允许跨域
        newHeaders.set('Access-Control-Allow-Origin', '*');
        
        // 缓存策略：s-maxage 会让 Cloudflare 边缘节点缓存，max-age 让浏览器缓存
        // 这里设置边缘缓存 30 天，浏览器缓存 7 天
        newHeaders.set('Cache-Control', 'public, s-maxage=2592000, max-age=604800');
        
        // 移除可能导致冲突的头
        newHeaders.delete('Set-Cookie');

        response = new Response(imageRes.body, {
          status: imageRes.status,
          headers: newHeaders,
        });

        // 4. 将响应写入缓存
        // 使用 ctx.waitUntil 确保在返回结果后，缓存写入操作能异步完成
        ctx.waitUntil(cache.put(request, response.clone()));
      }

      return response;
    }

    // 如果不是 /proxy 路径，则尝试返回静态资源（Pages 的默认行为）
    return env.ASSETS.fetch(request);
  },
};
