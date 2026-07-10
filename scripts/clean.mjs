#!/usr/bin/env node

import { rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await rm(path.join(projectRoot, 'dist'), { recursive: true, force: true });
