import { mount } from 'svelte';
import type { PluginFrontendMount } from '../../../core/plugin-contract/ui';
import View from './View.svelte';
import '../../../web/App.css';

const mountView: PluginFrontendMount = (api) => {
  if (!api.graph) {
    throw new Error('This view requires the graphView interface');
  }
  mount(View, { target: api.root as HTMLElement, props: { api } });
};
export default mountView;
