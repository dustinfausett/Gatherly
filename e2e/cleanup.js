import { rmSync } from 'node:fs';
export default () => { if (process.env.GATHERLY_E2E_DATA_DIR?.includes('gatherly-browser-')) rmSync(process.env.GATHERLY_E2E_DATA_DIR, { recursive: true, force: true }); };
