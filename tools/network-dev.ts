import { spawn } from 'node:child_process';
const children = [spawn(process.execPath,['--import','tsx','server/main.ts'],{stdio:'inherit'}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0','--port',process.env.BRICKS_DEV_PORT ?? '4188','--strictPort'],{stdio:'inherit'})];
let closing=false;
const stop=()=>{if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of children)child.on('exit',code=>{stop();process.exitCode=code ?? 0;});
