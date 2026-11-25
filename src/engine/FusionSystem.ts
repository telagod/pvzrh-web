import { assets } from '../assets/AssetLoader';

export interface FusionRecipeEntry {
  a: number;
  b: number;
  result: number;
  tier: number;
}

/**
 * Queries official PvZ Fusion `MixData` recipes compiled into `catalog.json`.
 * Supports bidirectional lookups (parents of a fusion, fusions possible with a plant,
 * and transitive primary-parent extraction for trait inheritance).
 */
class FusionSystem {
  private indexed = false;
  private readonly pairMap = new Map<string, number>();
  private readonly byResult = new Map<number, FusionRecipeEntry[]>();
  private readonly byIngredient = new Map<number, FusionRecipeEntry[]>();
  private readonly partnersMap = new Map<number, Set<number>>();

  private ensureIndexed(): void {
    if (this.indexed) {
      return;
    }
    const cat = assets.catalog;
    for (const [k, res] of Object.entries(cat.recipes)) {
      this.pairMap.set(k, res);
    }
    for (const [a, b, result, tier] of cat.recipeList) {
      const entry: FusionRecipeEntry = { a, b, result, tier };

      const rList = this.byResult.get(result) ?? [];
      rList.push(entry);
      this.byResult.set(result, rList);

      const iA = this.byIngredient.get(a) ?? [];
      iA.push(entry);
      this.byIngredient.set(a, iA);

      if (b !== a) {
        const iB = this.byIngredient.get(b) ?? [];
        iB.push(entry);
        this.byIngredient.set(b, iB);
      }

      const pA = this.partnersMap.get(a) ?? new Set<number>();
      pA.add(b);
      this.partnersMap.set(a, pA);

      const pB = this.partnersMap.get(b) ?? new Set<number>();
      pB.add(a);
      this.partnersMap.set(b, pB);
    }
    this.indexed = true;
  }

  getFusionResult(existingPlantId: number, incomingPlantId: number): number | null {
    this.ensureIndexed();
    const direct = this.pairMap.get(`${existingPlantId}|${incomingPlantId}`);
    if (direct !== undefined) {
      return direct;
    }
    const rev = this.pairMap.get(`${incomingPlantId}|${existingPlantId}`);
    return rev !== undefined ? rev : null;
  }

  canFuse(existingPlantId: number, incomingPlantId: number): boolean {
    return this.getFusionResult(existingPlantId, incomingPlantId) !== null;
  }

  getRecipesProducing(resultId: number): FusionRecipeEntry[] {
    this.ensureIndexed();
    return this.byResult.get(resultId) ?? [];
  }

  getRecipesUsing(plantId: number): FusionRecipeEntry[] {
    this.ensureIndexed();
    return this.byIngredient.get(plantId) ?? [];
  }

  getCompatiblePartners(plantId: number): Set<number> {
    this.ensureIndexed();
    return this.partnersMap.get(plantId) ?? new Set<number>();
  }

  /** Returns the two parent plant IDs from the lowest-tier recipe producing `resultId`. */
  getPrimaryParents(resultId: number): [number, number] | null {
    const list = this.getRecipesProducing(resultId);
    if (list.length === 0) {
      return null;
    }
    let best = list[0];
    for (const r of list) {
      if (r.tier < best.tier) {
        best = r;
      }
    }
    return [best.a, best.b];
  }
}

export const fusionSystem = new FusionSystem();
