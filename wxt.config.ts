import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

const e2e = process.env.CORMARK_E2E === '1';

export default defineConfig({
  srcDir: 'src',
  outDir: e2e ? '.output/e2e' : '.output',
  vite: () => ({
    plugins: [tailwindcss()],
    // shadcn components are written for React. Compat keeps the injected script small.
    resolve: {
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
        'react/jsx-runtime': 'preact/jsx-runtime',
      },
    },
  }),
  manifest: {
    name: 'Cormark',
    description: 'Annotate web pages and copy the notes as a prompt for a coding agent.',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // The per-site grant is a native dialog that Playwright can't click.
    ...(e2e ? { host_permissions: ['http://localhost/*'] } : {}),
    action: {
      default_title: 'Annotate this page',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+A' } },
    },
  },
});
