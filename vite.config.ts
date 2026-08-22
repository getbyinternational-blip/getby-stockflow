import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';

const VERSION_TEMPLATE_PATH = path.resolve(__dirname, 'public/version.json');
const VERSION_OUTPUT_PATH = path.resolve(__dirname, 'dist/version.json');
const CLOUDINARY_DEV_SIGN_PATHS = [
  '/api/cloudinary-sign-upload',
  '/.netlify/functions/cloudinary-sign-upload',
  '/netlify/functions/cloudinary-sign-upload',
];

const cloudinaryDevSignaturePlugin = (resolvedEnv: Record<string, string>) => ({
  name: 'cloudinary-dev-signature-endpoint',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      const requestUrl = String(req.url || '').split('?')[0];
      if (!CLOUDINARY_DEV_SIGN_PATHS.includes(requestUrl)) {
        next();
        return;
      }

      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }

      const cloudName = resolvedEnv.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = resolvedEnv.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY;
      const apiSecret = resolvedEnv.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET;
      const uploadFolder = (resolvedEnv.CLOUDINARY_UPLOAD_FOLDER || process.env.CLOUDINARY_UPLOAD_FOLDER || 'stockflow/products').trim();
      const uploadPreset = (resolvedEnv.CLOUDINARY_UPLOAD_PRESET || process.env.CLOUDINARY_UPLOAD_PRESET || '').trim();

      if (!cloudName || !apiKey || !apiSecret) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Cloudinary environment variables are not configured.' }));
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const stringToSign = uploadPreset
        ? `folder=${uploadFolder}&timestamp=${timestamp}&upload_preset=${uploadPreset}`
        : `folder=${uploadFolder}&timestamp=${timestamp}`;
      const signature = crypto
        .createHash('sha1')
        .update(`${stringToSign}${apiSecret}`)
        .digest('hex');

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        timestamp,
        signature,
        apiKey,
        cloudName,
        uploadFolder,
        uploadPreset,
      }));
    });
  },
});

const RECENT_COMMITS_DEV_PATH = '/api/recent-commits';

const recentCommitsDevPlugin = () => ({
  name: 'recent-commits-dev-endpoint',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      const requestUrl = String(req.url || '').split('?')[0];
      if (requestUrl !== RECENT_COMMITS_DEV_PATH) {
        next();
        return;
      }

      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }

      try {
        const now = new Date();
        const since = new Date(now);
        since.setDate(now.getDate() - 2);
        since.setHours(0, 0, 0, 0);
        const sinceIso = since.toISOString();
        const format = ['%H', '%ad', '%an', '%s', '%h'].join('%x1f');
        const raw = execSync(
          `git log --since="${sinceIso}" --date=short --pretty=format:"${format}"`,
          {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ).trim();

        const commits = raw
          ? raw.split(/\r?\n/).map((line) => {
              const [time, date, author, message, hash] = line.split('\x1f');
              return { time, date, author, message, hash };
            })
          : [];

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ commits }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unable to read commit history.',
        }));
      }
    });
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const buildId = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString();
    const deployedAt = new Date().toISOString();
    const versionTargetUrl = process.env.VERSION_TARGET_URL || '';
    const preferredPort = Number.parseInt(process.env.PORT || '3000', 10);
    return {
      server: {
        port: Number.isFinite(preferredPort) ? preferredPort : 3000,
        strictPort: false,
        host: '127.0.0.1',
      },
      plugins: [react(), cloudinaryDevSignaturePlugin(env), recentCommitsDevPlugin()],
      define: {
        APP_BUILD_ID: JSON.stringify(buildId),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      build: {
        rollupOptions: {
          plugins: [{
            name: 'write-version-json',
            closeBundle() {
              if (!fs.existsSync(VERSION_TEMPLATE_PATH) || !fs.existsSync(VERSION_OUTPUT_PATH)) return;
              const raw = fs.readFileSync(VERSION_TEMPLATE_PATH, 'utf8');
              const output = raw
                .replaceAll('__APP_BUILD_ID__', buildId)
                .replaceAll('__DEPLOYED_AT__', deployedAt)
                .replaceAll('__TARGET_URL__', versionTargetUrl);
              fs.writeFileSync(VERSION_OUTPUT_PATH, output, 'utf8');
            },
          }]
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
