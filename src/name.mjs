// The tool's name lives in package.json only; every file name, folder, URL prefix and command derives from it here.
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const NAME = pkg.name;
export const VERSION = pkg.version;
export const CONFIG_FILE = `${NAME}.config.json`;
export const DATA_DIR = `.${NAME}`;
export const COMMENTS_FILE = `${DATA_DIR}/comments.json`;
export const PREFIX = `/__${NAME}`;
export const RUN = `npx -y ${NAME}`;
export const BOARD_PORT = 5191;
