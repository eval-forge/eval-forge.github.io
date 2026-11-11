/** Scene builders. Each is a generator so construction can be spread over frames. */
import type { SceneId } from '../../core/scenes';
import type { SceneKit } from '../kit';
import { buildCatacombs } from './catacombs';
import { buildCliffs } from './cliffs';
import { buildCourtyard } from './courtyard';
import { buildHalls } from './halls';
import { buildJungle } from './jungle';
import { buildSanctum } from './sanctum';
import { buildVault } from './vault';

export const BUILDERS: Record<SceneId, (k: SceneKit) => Generator<void>> = {
  jungle: buildJungle,
  courtyard: buildCourtyard,
  cliffs: buildCliffs,
  halls: buildHalls,
  sanctum: buildSanctum,
  catacombs: buildCatacombs,
  vault: buildVault,
};
