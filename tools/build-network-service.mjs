import {build} from 'esbuild';
await build({entryPoints:['server/main.ts'],outfile:'build/network-service.mjs',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',sourcemap:true});
