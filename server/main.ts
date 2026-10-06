import { createNetworkServer } from './http';
const port = Number(process.env.BRICKS_NETWORK_PORT ?? 4190);
const origins = (process.env.BRICKS_NETWORK_ORIGINS ?? '').split(',').filter(Boolean);
const runtime = createNetworkServer(undefined, origins, undefined, process.env.BRICKS_NETWORK_TRUST_PROXY === '1');
runtime.server.listen(port, '127.0.0.1', () => console.log(`Bricks network service on 127.0.0.1:${port}`));
let stopping = false;
const shutdown = () => {if (stopping) return; stopping = true; void runtime.close().then(() => process.exit(0));};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
