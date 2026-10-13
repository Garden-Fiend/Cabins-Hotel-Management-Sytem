import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
if (process.env.HMS_BOOKING_ON_DEMAND !== '1') throw new Error('Use node booking-tests/run.mjs with an explicit execution mode. No automatic runs.');
const folder=process.env.HMS_BOOKING_SESSION;
export default defineConfig({
  testDir: '.', testMatch:'**/*.pw.mjs', timeout:45000, expect:{timeout:6000},
  fullyParallel:false, workers:1, retries:0,
  outputDir:resolve(folder,'artifacts'),
  reporter:[['list'],['./reporter.mjs'],['html',{outputFolder:resolve(folder,'playwright'),open:'never'}]],
  use:{baseURL:process.env.HMS_BOOKING_BASE_URL ?? 'http://127.0.0.1:5173',browserName:'chromium',
    timezoneId:'Asia/Manila',locale:'en-PH',viewport:{width:1600,height:1050},
    screenshot:'on',trace:'retain-on-failure',video:'retain-on-failure',actionTimeout:8000},
  webServer:process.env.HMS_BOOKING_BASE_URL?undefined:{command:'npm run dev -- --config booking-tests/vite.config.mjs --host 127.0.0.1 --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:false,timeout:30000},
});
