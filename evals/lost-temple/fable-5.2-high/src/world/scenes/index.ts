import type { SceneId } from '../../core/types';
import type { SceneDef } from '../types';
import { catacombs } from './catacombs';
import { cliffs } from './cliffs';
import { courtyard } from './courtyard';
import { halls } from './halls';
import { jungle } from './jungle';
import { sanctum } from './sanctum';
import { vault } from './vault';

export const SCENES: Record<SceneId, SceneDef> = { jungle, courtyard, cliffs, halls, sanctum, catacombs, vault };
