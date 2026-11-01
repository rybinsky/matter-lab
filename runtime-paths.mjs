import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const appRoot=path.dirname(fileURLToPath(import.meta.url));
export const dataDir=process.env.MATTER_LAB_DATA_DIR?path.resolve(process.env.MATTER_LAB_DATA_DIR):null;
export const mediaDir=path.resolve(process.env.MATTER_LAB_MEDIA_DIR||(dataDir?path.join(dataDir,'videos'):path.join(appRoot,'../matter-lab-videos')));
export const cacheDir=path.resolve(process.env.MATTER_LAB_CACHE_DIR||(dataDir?path.join(dataDir,'cache'):path.join(appRoot,'.cache')));
export const projectsDir=path.resolve(process.env.MATTER_LAB_PROJECTS_DIR||(dataDir?path.join(dataDir,'projects'):path.join(cacheDir,'projects')));
export const renderBinary=path.resolve(process.env.MATTER_LAB_RENDER_BINARY||path.join(cacheDir,'render-native'));
