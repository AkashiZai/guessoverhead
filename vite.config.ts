import {defineConfig} from 'vite';
import {createServer} from 'node:http';
import {setupGameServer} from './server/game';

declare global {
  // eslint-disable-next-line no-var
  var __gameServer: ReturnType<typeof createServer> | undefined;
}

export default defineConfig(({command}) => {
  if (command === 'serve') {
    if (!globalThis.__gameServer) {
      const srv = createServer((req, res) => res.writeHead(200).end('OK'));
      setupGameServer(srv);
      srv.listen(3001, '127.0.0.1', () => {
        console.log('[Dev-GameServer] Backend WebSocket running on 127.0.0.1:3001');
      });
      globalThis.__gameServer = srv;
    }
  }

  return {
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/ws': {
          target: 'ws://127.0.0.1:3001',
          ws: true
        }
      }
    }
  };
});
