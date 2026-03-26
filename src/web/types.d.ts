declare const __APP_VERSION__: string;

declare module '3d-force-graph' {
  export default function ForceGraph3D(): (element: HTMLElement) => ForceGraph3DInstance;

  interface ForceGraph3DInstance {
    graphData(data?: any): ForceGraph3DInstance;
    nodeId(id: string): ForceGraph3DInstance;
    nodeLabel(label: string | ((node: any) => string)): ForceGraph3DInstance;
    nodeColor(color: string | ((node: any) => string)): ForceGraph3DInstance;
    nodeRelSize(size: number): ForceGraph3DInstance;
    nodeOpacity(opacity: number): ForceGraph3DInstance;
    linkColor(color: string | ((link: any) => string)): ForceGraph3DInstance;
    linkWidth(width: number | ((link: any) => number)): ForceGraph3DInstance;
    linkOpacity(opacity: number): ForceGraph3DInstance;
    linkDirectionalArrowLength(length: number | ((link: any) => number)): ForceGraph3DInstance;
    linkDirectionalArrowRelPos(pos: number): ForceGraph3DInstance;
    linkDirectionalParticles(count: number | ((link: any) => number)): ForceGraph3DInstance;
    linkDirectionalParticleWidth(width: number): ForceGraph3DInstance;
    backgroundColor(color: string): ForceGraph3DInstance;
    width(width: number): ForceGraph3DInstance;
    height(height: number): ForceGraph3DInstance;
    onNodeClick(callback: (node: any, event: MouseEvent) => void): ForceGraph3DInstance;
    cooldownTicks(ticks: number): ForceGraph3DInstance;
    warmupTicks(ticks: number): ForceGraph3DInstance;
    d3AlphaDecay(decay: number): ForceGraph3DInstance;
    d3VelocityDecay(decay: number): ForceGraph3DInstance;
    d3Force(name: string, force?: any): any;
    d3ReheatSimulation(): ForceGraph3DInstance;
    cameraPosition(position: any, lookAt?: any, transitionMs?: number): ForceGraph3DInstance;
    nodeVisibility(fn: (node: any) => boolean): ForceGraph3DInstance;
    linkVisibility(fn: (link: any) => boolean): ForceGraph3DInstance;
    zoomToFit(duration?: number): ForceGraph3DInstance;
    scene(): any;
    camera(): any;
    renderer(): any;
    controls(): any;
    _destructor?(): void;
    [key: string]: any;
  }
}
