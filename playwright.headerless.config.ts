import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',workers:1,retries:0,
 testMatch:['game.spec.ts','mobile-release-parity.spec.ts','until-victory.spec.ts','clear-presentation.spec.ts','shield-reflection.spec.ts'],
 grep:/launches four compact|keeps a one-player|counts down the selected|keeps the arena paused|restarts with the same|uses the Menu gamepad|Start Menu|supported phone release flow|phone Battle context|retains board geometry|supports until-victory|pauses the real burn|residual debt/,
 use:{baseURL:'http://127.0.0.1:4187',viewport:{width:1440,height:960},channel:'chrome',launchOptions:{args:['--mute-audio']}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort',url:'http://127.0.0.1:4187',reuseExistingServer:false},
});
