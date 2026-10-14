import path from 'path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function sheetProxyPlugin(): Plugin {
  const handler = async (req: any, res: any) => {
    try {
      const parsedUrl = new URL(req.url || '', 'http://localhost');
      const target = parsedUrl.searchParams.get('url');
      if (!target) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Missing url query parameter');
        return;
      }

      const targetObj = new URL(target);
      if (!targetObj.hostname.endsWith('google.com') && !targetObj.hostname.endsWith('googleusercontent.com')) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Forbidden target host');
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const upstreamRes = await fetch(target, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      clearTimeout(timeout);

      res.statusCode = upstreamRes.status;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'text/csv; charset=utf-8');

      if (!upstreamRes.body) {
        const text = await upstreamRes.text();
        res.end(text);
        return;
      }

      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err: any) {
      console.error('Sheet proxy error:', err);
      res.statusCode = 500;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(err.message || 'Proxy internal error');
    }
  };

  return {
    name: 'sheet-proxy-plugin',
    configureServer(server) {
      server.middlewares.use('/api/sheet-proxy', (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        handler(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/sheet-proxy', (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        handler(req, res);
      });
    }
  };
}

export default defineConfig(({ mode }) => {
        return {
      // './' 讓網站在任何 GitHub Pages 路徑下都能載入
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), sheetProxyPlugin()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
