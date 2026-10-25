import type { Editor } from '../editor';
import type { ToolId } from '../../store/settings';
import { BrushTool } from './brushTool';
import { EyedropperTool, FillTool, HandTool, LassoFillTool, SelectTool } from './simpleTools';
import type { Tool } from './tool';
import { GradientTool } from './gradientTool';
import { RulerTool } from './rulerTool';
import { ShapeTool } from './shapeTool';
import { TransformTool } from './transformTool';

export function createTools(ed: Editor): Record<ToolId, Tool> {
  return {
    brush: new BrushTool(ed, 'brush'),
    eraser: new BrushTool(ed, 'eraser'),
    smudge: new BrushTool(ed, 'smudge'),
    blur: new BrushTool(ed, 'blur'),
    fill: new FillTool(ed),
    lassoFill: new LassoFillTool(ed),
    select: new SelectTool(ed),
    transform: new TransformTool(ed),
    eyedropper: new EyedropperTool(ed),
    hand: new HandTool(ed),
    ruler: new RulerTool(ed),
    shape: new ShapeTool(ed),
    gradient: new GradientTool(ed),
  };
}
