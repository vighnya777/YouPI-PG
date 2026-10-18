import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPublicGateway } from './server.js';

export { PublicGatewayServer, startPublicGateway } from './server.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startPublicGateway();
}
