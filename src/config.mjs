import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const TOOL=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configFile=path.join(TOOL,'local','workspace.json');
export const workspaceConfig=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
export const ROOT=path.resolve(TOOL,workspaceConfig.workspaceRoot||'examples/demo-workspace');
if(ROOT===TOOL)throw new Error('Choose a dedicated source directory, not the package root');
export const DEMO=!fs.existsSync(configFile);
