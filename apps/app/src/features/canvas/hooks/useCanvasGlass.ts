import { useAutoLiquidGlassFilter } from '../../../components/LiquidGlass';

type GlassRender = ReturnType<typeof useAutoLiquidGlassFilter>;

export type CanvasGlass = {
  searchPillGlass: GlassRender;
  statusPillGlass: GlassRender;
  controlsPillGlass: GlassRender;
  wordmarkGlass: GlassRender;
  settingsPillGlass: GlassRender;
};

/**
 * Five separately-positioned liquid-glass filter contexts for the HUD
 * pills + the wordmark. Each call subscribes to its own backdrop
 * recomputation; bundling here keeps the wiring out of the Canvas body.
 */
export function useCanvasGlass(): CanvasGlass {
  const searchPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const statusPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const controlsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const wordmarkGlass = useAutoLiquidGlassFilter({ radius: 10 });
  const settingsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  return {
    searchPillGlass,
    statusPillGlass,
    controlsPillGlass,
    wordmarkGlass,
    settingsPillGlass,
  };
}
