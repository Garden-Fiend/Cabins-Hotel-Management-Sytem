import { mergeConfig } from 'vite';
import applicationConfig from '../vite.config.ts';
// Test-only server configuration: generated reports must never reset in-memory scenarios.
export default mergeConfig(applicationConfig,{
  server:{hmr:false,watch:{ignored:['**/booking-tests/**']}},
});
